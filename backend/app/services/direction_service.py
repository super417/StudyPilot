"""Read-only direction / job / skill-gap views over static JSON data."""

from __future__ import annotations

from collections import Counter
from typing import Any

from app.core.data_files import load_courses, load_jobs
from app.services import resource_links, retrieval

# Ranked fragments kept per query. Every direction holds at least three verified
# courses, so K stays below the catalogue size: a plan is never offered the
# whole library. Callers may pass their own ``k`` for tests.
COURSE_CANDIDATE_K = 2

# A course covers a skill only when every query bigram appears in its fragment.
# Partial overlap is not coverage: 技能丙 shares the 技能 bigram with 技能甲 but
# no course teaches it, and reporting that as a match would invent one.
SKILL_QUERY_MIN_COVERAGE = 1.0


class DirectionNotFoundError(ValueError):
    code = "NOT_FOUND"

    def __init__(self, message: str = "还没有这个方向") -> None:
        super().__init__(message)


def _course_direction(courses_data: dict, direction_id: str) -> dict:
    for item in courses_data.get("directions") or []:
        if item.get("id") == direction_id:
            return item
    raise DirectionNotFoundError()


def _job_direction(jobs_data: dict, direction_id: str) -> dict | None:
    for item in jobs_data.get("directions") or []:
        if item.get("id") == direction_id:
            return item
    return None


def _job_dict(job: dict) -> dict[str, Any]:
    return {
        "jobId": job.get("job_id", ""),
        "title": job.get("title", ""),
        "companyType": job.get("company_type", ""),
        "city": job.get("city", ""),
        "seniority": job.get("seniority", ""),
        "education": job.get("education", ""),
        "majorPref": job.get("major_pref") or [],
        "skillsRequired": job.get("skills_required") or [],
        "skillsPreferred": job.get("skills_preferred") or [],
        "sourcePlatform": job.get("source_platform", ""),
        "sourceUrl": job.get("source_url", ""),
        "collectedAt": job.get("collected_at", ""),
        "verification": job.get("verification", ""),
    }


def _course_ref(item: dict) -> dict[str, Any]:
    """Project one ranked course hit into the response shape.

    ``section``, ``rank``, and ``score`` are appended fields; the first six keys
    keep the meaning they had before retrieval ranking was introduced.
    """
    return {
        "courseId": item.get("courseId", ""),
        "name": item.get("name", ""),
        "institution": item.get("institution", ""),
        "provider": item.get("provider", ""),
        "url": item.get("url", ""),
        "collectedAt": item.get("collectedAt", ""),
        "section": item.get("section"),
        "rank": item.get("rank"),
        "score": item.get("score"),
    }


def _fragment(
    course: dict,
    chunk_index: int,
    chapter_index: int | None,
    section: str,
    content: str,
) -> dict[str, Any]:
    """One retrievable course fragment, carrying everything needed to answer."""
    return {
        "doc_id": str(course.get("course_id") or ""),
        "chunk_index": chunk_index,
        "course_id": str(course.get("course_id") or ""),
        "chapter_index": chapter_index,
        "section": section,
        "content": content,
        "course": course,
    }


def _course_fragments(direction: dict) -> list[dict[str, Any]]:
    """Split verified courses into section fragments for BM25.

    Every section of every chapter becomes one fragment whose content carries
    the course name, institution, skills, chapter title, and section title — a
    bare section title would match text with no course behind it. A chapter
    without sections falls back to a chapter-level fragment (``section`` empty),
    and a course without chapters to its metadata, so older fixtures stay
    retrievable. Only ``url_verified`` courses with a URL produce fragments.
    """
    fragments: list[dict[str, Any]] = []
    for course in direction.get("courses") or []:
        if course.get("url_verified") is not True:
            continue
        if not str(course.get("url") or "").strip():
            continue
        head = " ".join(
            part
            for part in (
                str(course.get("name") or ""),
                str(course.get("institution") or ""),
                " ".join(str(skill) for skill in course.get("skills") or [] if skill),
            )
            if part
        )
        chapters = [
            chapter for chapter in course.get("chapters") or [] if isinstance(chapter, dict)
        ]
        if not chapters:
            fragments.append(_fragment(course, len(fragments), None, "", head))
            continue
        for offset, chapter in enumerate(chapters):
            chapter_title = str(chapter.get("title") or "")
            chapter_index = chapter.get("index")
            if not isinstance(chapter_index, int):
                chapter_index = offset + 1
            titles = [
                str(section).strip()
                for section in chapter.get("sections") or []
                if str(section).strip()
            ] or [""]
            for section_title in titles:
                content = " ".join(
                    part for part in (head, chapter_title, section_title) if part
                )
                fragments.append(
                    _fragment(course, len(fragments), chapter_index, section_title, content)
                )
    return fragments


def _fragment_url(fragment: dict) -> str:
    """Section URL when the course lists one and it passes the host check.

    ``section_urls`` is optional in the data file and absent from every course
    today. A missing entry, a section the map does not list, or an unusable
    address all fall back to the course URL — a URL is never derived from a
    section title.
    """
    course = fragment.get("course") or {}
    section = fragment.get("section")
    section_urls = course.get("section_urls")
    if section and isinstance(section_urls, dict):
        raw = section_urls.get(section)
        if isinstance(raw, str):
            verified = resource_links.sanitize_resource_url(raw)
            if verified:
                return verified
    return str(course.get("url") or "").strip()


def rank_courses(
    direction_id: str,
    query: str,
    k: int = COURSE_CANDIDATE_K,
    min_coverage: float = 0.0,
    courses_data: dict | None = None,
) -> list[dict[str, Any]]:
    """Rank a direction's courses for ``query`` and keep the best hit per course.

    ``retrieval.rank`` is called through the module object so tests can
    monkeypatch it. Every fragment is scored (``k`` only caps the returned
    slice), so ``k`` here counts de-duplicated courses: the first hit of a
    course decides its order, section, and URL. An empty ranking returns
    ``[]`` — never a fabricated match.
    """
    direction_id = str(direction_id or "").strip()
    if not direction_id:
        return []
    courses_data = courses_data if courses_data is not None else load_courses()
    try:
        course_dir = _course_direction(courses_data, direction_id)
    except DirectionNotFoundError:
        return []
    fragments = _course_fragments(course_dir)
    if not fragments:
        return []
    hits = retrieval.rank(
        query, fragments, k=len(fragments), min_coverage=min_coverage
    )
    ranked: list[dict[str, Any]] = []
    seen: set[str] = set()
    for fragment, score in hits:
        if len(ranked) >= k:
            break
        course_id = fragment.get("course_id") or ""
        if not course_id or course_id in seen:
            continue
        seen.add(course_id)
        course = fragment.get("course") or {}
        ranked.append(
            {
                "courseId": course_id,
                "name": course.get("name", ""),
                "institution": course.get("institution", ""),
                "provider": course.get("provider", ""),
                "url": _fragment_url(fragment),
                "collectedAt": course.get("collected_at", ""),
                "section": fragment.get("section") or None,
                "rank": len(ranked) + 1,
                "score": round(score, 4),
            }
        )
    return ranked


def parse_known(raw: str | None) -> list[str]:
    if not raw:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for part in raw.split(","):
        skill = part.strip()
        if not skill or skill in seen:
            continue
        seen.add(skill)
        out.append(skill)
    return out


def list_directions(
    jobs_data: dict | None = None,
    courses_data: dict | None = None,
) -> list[dict[str, Any]]:
    jobs_data = jobs_data if jobs_data is not None else load_jobs()
    courses_data = courses_data if courses_data is not None else load_courses()
    jobs_by_id = {
        item.get("id"): item for item in (jobs_data.get("directions") or [])
    }
    result: list[dict[str, Any]] = []
    for course_dir in courses_data.get("directions") or []:
        direction_id = course_dir.get("id")
        if not direction_id:
            continue
        job_dir = jobs_by_id.get(direction_id) or {}
        result.append(
            {
                "id": direction_id,
                "name": course_dir.get("name", ""),
                "description": course_dir.get("description") or "",
                "jobCount": len(job_dir.get("jobs") or []),
                "courseCount": len(course_dir.get("courses") or []),
                "skills": list(course_dir.get("skills") or []),
            }
        )
    return result


def list_jobs(
    direction_id: str,
    jobs_data: dict | None = None,
    courses_data: dict | None = None,
) -> dict[str, Any]:
    jobs_data = jobs_data if jobs_data is not None else load_jobs()
    courses_data = courses_data if courses_data is not None else load_courses()
    course_dir = _course_direction(courses_data, direction_id)
    job_dir = _job_direction(jobs_data, direction_id)
    jobs = job_dir.get("jobs") or [] if job_dir else []
    return {
        "directionId": direction_id,
        "directionName": course_dir.get("name", ""),
        "jobs": [_job_dict(job) for job in jobs],
    }


def compute_skill_gap(
    direction_id: str,
    known: list[str],
    jobs_data: dict | None = None,
    courses_data: dict | None = None,
) -> dict[str, Any]:
    jobs_data = jobs_data if jobs_data is not None else load_jobs()
    courses_data = courses_data if courses_data is not None else load_courses()
    course_dir = _course_direction(courses_data, direction_id)
    job_dir = _job_direction(jobs_data, direction_id)
    jobs = job_dir.get("jobs") or [] if job_dir else []

    required_counts: Counter[str] = Counter()
    preferred_counts: Counter[str] = Counter()
    for job in jobs:
        for skill in job.get("skills_required") or []:
            if skill:
                required_counts[skill] += 1
        for skill in job.get("skills_preferred") or []:
            if skill:
                preferred_counts[skill] += 1

    known_set = set(known)
    direction_skills = list(course_dir.get("skills") or [])
    direction_skill_set = set(direction_skills)
    job_count = len(jobs)

    all_skills = set(required_counts) | set(preferred_counts)
    ranked = sorted(
        all_skills,
        key=lambda skill: (
            -required_counts[skill],
            -preferred_counts[skill],
            skill,
        ),
    )

    gaps: list[dict[str, Any]] = []
    for skill in ranked:
        if skill in known_set:
            continue
        # Ranked retrieval, not ``skill in course.skills``: the course that best
        # covers this skill leads, and an empty result stays empty.
        matching = [
            _course_ref(item)
            for item in rank_courses(
                direction_id,
                skill,
                min_coverage=SKILL_QUERY_MIN_COVERAGE,
                courses_data=courses_data,
            )
        ]
        gaps.append(
            {
                "skill": skill,
                "requiredBy": required_counts[skill],
                "preferredBy": preferred_counts[skill],
                "jobCount": job_count,
                "courses": matching,
            }
        )

    covered = sum(1 for skill in known if skill in direction_skill_set)
    total = len(direction_skills)
    percent = round(covered / total * 100) if total else 0

    return {
        "directionId": direction_id,
        "directionName": course_dir.get("name", ""),
        "knownSkills": list(known),
        "gaps": gaps,
        "coverage": {"total": total, "covered": covered, "percent": percent},
    }


def skill_gap(direction_id: str, known_raw: str | None) -> dict[str, Any]:
    return compute_skill_gap(direction_id, parse_known(known_raw))


def verified_course_candidates(
    direction_id: str | None,
    courses_data: dict | None = None,
) -> list[dict[str, Any]]:
    """Return ``{courseId, name, url}`` for ``url_verified is True`` courses.

    Unknown or empty ``direction_id`` yields an empty list (plan generation
    continues without course anchoring). Never invents URLs.
    """
    if not direction_id or not str(direction_id).strip():
        return []
    courses_data = courses_data if courses_data is not None else load_courses()
    try:
        course_dir = _course_direction(courses_data, str(direction_id).strip())
    except DirectionNotFoundError:
        return []
    out: list[dict[str, Any]] = []
    for course in course_dir.get("courses") or []:
        if course.get("url_verified") is not True:
            continue
        url = str(course.get("url") or "").strip()
        if not url:
            continue
        out.append(
            {
                "courseId": course.get("course_id", ""),
                "name": course.get("name", ""),
                "url": url,
            }
        )
    return out


def allowed_course_urls(
    direction_id: str | None,
    courses_data: dict | None = None,
) -> frozenset[str]:
    return frozenset(
        item["url"]
        for item in verified_course_candidates(direction_id, courses_data)
        if item.get("url")
    )
