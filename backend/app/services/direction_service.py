"""Read-only direction / job / skill-gap views over static JSON data."""

from __future__ import annotations

from collections import Counter
import re
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
        "chapterTitle": item.get("chapterTitle"),
        "sectionTitle": item.get("sectionTitle"),
        "rank": item.get("rank"),
        "score": item.get("score"),
    }


def _fragment(
    course: dict,
    chunk_index: int,
    chapter_index: int | None,
    chapter_title: str,
    chapter_url: str | None,
    section: str,
    content: str,
) -> dict[str, Any]:
    """One retrievable course fragment, carrying everything needed to answer."""
    return {
        "doc_id": str(course.get("course_id") or ""),
        "chunk_index": chunk_index,
        "course_id": str(course.get("course_id") or ""),
        "chapter_index": chapter_index,
        "chapter_title": chapter_title,
        "chapter_url": chapter_url,
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
            fragments.append(_fragment(course, len(fragments), None, "", None, "", head))
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
                    _fragment(
                        course,
                        len(fragments),
                        chapter_index,
                        chapter_title,
                        chapter.get("url"),
                        section_title,
                        content,
                    )
                )
    return fragments


def _fragment_url(fragment: dict) -> str:
    """Use the matched section's chapter URL, then the course URL.

    The chapter URL is optional. Never derive a URL from a section title.
    """
    course = fragment.get("course") or {}
    chapter_url = resource_links.sanitize_resource_url(fragment.get("chapter_url"))
    if chapter_url:
        return chapter_url
    return resource_links.sanitize_resource_url(course.get("url")) or ""


def _chapter_label(fragment: dict) -> str | None:
    title = str(fragment.get("chapter_title") or "").strip()
    index = fragment.get("chapter_index")
    if title and isinstance(index, int) and not re.match(r"^第\s*[\d一二三四五六七八九十]+\s*章", title):
        return f"第 {index} 章 {title}"
    return title or None



def _topic_terms(text: str) -> set[str]:
    generic = r"学习|课程|基础|练习|完成|了解|掌握|理解|复习|入门|知识|内容|方法|^学"
    return {term for term in retrieval.tokenize(re.sub(generic, " ", text)) if not term.isdigit()}


def _task_topic(description: str) -> str:
    # Match the knowledge topic, not trailing deliverables such as print/orders.
    first = re.split(r"[，,。；;\n]", description, maxsplit=1)[0]
    parts = re.split(r"[：:]", first, maxsplit=1)
    topic = " ".join(parts) if re.search(r"[A-Za-z]", parts[0]) else parts[-1]
    return re.sub(r"的区别|区别|以及|及其|与|和", " ", topic).strip()


def _matches_topic(task_terms: set[str], course_terms: set[str], outline_terms: set[str]) -> bool:
    specific_terms = task_terms - course_terms
    if specific_terms:
        latin = {term for term in specific_terms if term.isascii() and not term.isdigit()}
        if latin and not latin.intersection(outline_terms):
            return False
        return len(specific_terms & outline_terms) / len(specific_terms) >= 0.5
    return bool(task_terms & course_terms)


def matches_task_outline(description: str, item: dict) -> bool:
    """Conservative topic comparison with stored metadata, not a live check."""
    outline = " ".join(str(item.get(key) or "") for key in ("chapterTitle", "sectionTitle", "section"))
    return _matches_topic(_topic_terms(_task_topic(description)), _topic_terms(str(item.get("name") or "")), _topic_terms(outline))



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
        if not _fragment_url(fragment):
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
                "chapterTitle": _chapter_label(fragment),
                "sectionTitle": fragment.get("section") or None,
                "rank": len(ranked) + 1,
                "score": round(score, 4),
            }
        )
    return ranked


_resource_catalog: dict | None = None
_resource_matches: dict[tuple[str, str | None], list[dict]] = {}
_resource_index: list[tuple[dict, set[str], set[str], str]] = []


def task_resource_candidates(description: str, direction_id: str | None = None) -> list[dict]:
    """Search indexed public outlines by task, independent of goal shortlist."""
    global _resource_catalog
    courses_data = load_courses()
    if courses_data is not _resource_catalog:
        _resource_catalog = courses_data
        _resource_matches.clear()
        _resource_index.clear()
        for direction in courses_data.get("directions") or []:
            for fragment in _course_fragments(direction):
                url = _fragment_url(fragment)
                if not url:
                    continue
                course = fragment["course"]
                item = {
                    "url": url, "courseId": fragment["course_id"],
                    "name": course.get("name", ""),
                    "chapterTitle": _chapter_label(fragment),
                    "sectionTitle": fragment.get("section") or None,
                    "section": fragment.get("section") or None,
                }
                outline = " ".join(str(item.get(key) or "") for key in ("chapterTitle", "sectionTitle"))
                _resource_index.append((item, _topic_terms(item["name"]), _topic_terms(outline), direction.get("id", "")))
    cache_key = (description, direction_id)
    if cache_key in _resource_matches:
        return _resource_matches[cache_key]
    terms = _topic_terms(_task_topic(description))
    matches = []
    for item, title_terms, outline_terms, current_id in _resource_index:
        if _matches_topic(terms, title_terms, outline_terms):
            score = len(terms & outline_terms) * 2 + len(terms & title_terms)
            matches.append(({**item, "score": score}, current_id == direction_id))
    matches.sort(key=lambda row: (-row[0]["score"], not row[1], row[0]["courseId"]))
    result = []
    seen = set()
    for item, _ in matches:
        if item["url"] not in seen:
            seen.add(item["url"])
            result.append(item)
    if len(_resource_matches) >= 256:
        _resource_matches.clear()
    _resource_matches[cache_key] = result
    return result


def task_resource_fields(task: Any) -> dict:
    """Enrich visible legacy tasks without changing stored rows or snapshots."""
    stored = resource_links.sanitize_resource_url(task.resource_url)
    if stored:
        match = {}
        if not task.chapter_title and not task.section_title:
            match = next((item for item in task_resource_candidates(str(task.description or "")) if item["url"] == stored), {})
        return {"resourceUrl": stored, "chapterTitle": task.chapter_title or match.get("chapterTitle"), "sectionTitle": task.section_title or match.get("sectionTitle")}
    matches = task_resource_candidates(str(task.description or ""))
    match = matches[0] if matches else {}
    return {
        "resourceUrl": match.get("url"),
        "chapterTitle": match.get("chapterTitle"),
        "sectionTitle": match.get("sectionTitle"),
    }


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
