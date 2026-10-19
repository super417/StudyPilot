"""Read-only direction / job / skill-gap views over static JSON data."""

from __future__ import annotations

from collections import Counter
from typing import Any

from app.core.data_files import load_courses, load_jobs


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


def _course_ref(course: dict) -> dict[str, Any]:
    return {
        "courseId": course.get("course_id", ""),
        "name": course.get("name", ""),
        "institution": course.get("institution", ""),
        "provider": course.get("provider", ""),
        "url": course.get("url", ""),
        "collectedAt": course.get("collected_at", ""),
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

    verified_courses = [
        course
        for course in (course_dir.get("courses") or [])
        if course.get("url_verified") is True
    ]

    gaps: list[dict[str, Any]] = []
    for skill in ranked:
        if skill in known_set:
            continue
        matching = [
            _course_ref(course)
            for course in verified_courses
            if skill in (course.get("skills") or [])
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
