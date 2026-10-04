"""Subject list for the profile course card.

A course is a name the user is studying. The next task is the earliest pending
daily task on the latest plan whose phase name or description contains that
name. ponytail: substring match, not a task-to-course foreign key.
"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Course, DailyTask, Phase, Plan

NAME_MAX = 64
VALID_STATUSES = ("active", "paused")
NO_TASK = "还没排到这门课"


class CourseValidationError(ValueError):
    code = "VALIDATION"

    def __init__(self, message: str = "课程内容不合法") -> None:
        super().__init__(message)


class CourseNotFoundError(ValueError):
    code = "NOT_FOUND"

    def __init__(self, message: str = "课程不存在") -> None:
        super().__init__(message)


def _name(value: object) -> str:
    text = "" if value is None else str(value).strip()
    if not text:
        raise CourseValidationError("请填写课程名称")
    if len(text) > NAME_MAX:
        raise CourseValidationError(f"课程名称最多 {NAME_MAX} 字")
    return text


def _status(value: object) -> str:
    text = "active" if value is None else str(value).strip()
    if text not in VALID_STATUSES:
        raise CourseValidationError("课程状态只能是在学或暂停")
    return text


def course_dict(course: Course) -> dict:
    return {
        "id": str(course.id),
        "name": course.name,
        "status": course.status,
        "updatedAt": course.updated_at.isoformat(),
    }


def _courses(session: Session, user_id: uuid.UUID) -> list[Course]:
    return list(
        session.scalars(
            select(Course)
            .where(Course.user_id == user_id)
            .order_by(Course.updated_at.desc(), Course.id)
        )
    )


def _ensure_unique(
    session: Session, user_id: uuid.UUID, name: str, except_id: uuid.UUID | None
) -> None:
    existing = session.scalar(
        select(Course).where(Course.user_id == user_id, Course.name == name)
    )
    if existing is not None and existing.id != except_id:
        raise CourseValidationError("已有同名课程")


def next_task_for_course(session: Session, user_id: uuid.UUID, course_name: str) -> str:
    plan = session.scalar(
        select(Plan)
        .where(Plan.user_id == user_id)
        .order_by(Plan.created_at.desc(), Plan.updated_at.desc())
        .limit(1)
    )
    if plan is None or not course_name:
        return NO_TASK
    rows = session.execute(
        select(DailyTask, Phase)
        .join(Phase, Phase.id == DailyTask.phase_id)
        .where(DailyTask.plan_id == plan.id, DailyTask.status == "pending")
        .order_by(DailyTask.task_date, DailyTask.id)
    ).all()
    for task, phase in rows:
        if course_name in phase.name or course_name in task.description:
            return task.description
    return NO_TASK


def course_overview(session: Session, user_id: uuid.UUID) -> dict:
    courses = _courses(session, user_id)
    recent = courses[0] if courses else None
    return {
        "activeCount": sum(1 for course in courses if course.status == "active"),
        "recentCourse": recent.name if recent else "",
        "nextTask": next_task_for_course(session, user_id, recent.name) if recent else "",
        "courses": [course_dict(course) for course in courses],
    }


def create_course(
    session: Session, user_id: uuid.UUID, *, name: object, status: object = "active"
) -> dict:
    cleaned = _name(name)
    _ensure_unique(session, user_id, cleaned, None)
    now = datetime.now(timezone.utc)
    course = Course(
        user_id=user_id,
        name=cleaned,
        status=_status(status),
        created_at=now,
        updated_at=now,
    )
    session.add(course)
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    return course_overview(session, user_id)


def update_course(
    session: Session,
    user_id: uuid.UUID,
    course_id: uuid.UUID,
    *,
    name: object,
    status: object,
) -> dict:
    course = session.scalar(
        select(Course).where(Course.id == course_id, Course.user_id == user_id)
    )
    if course is None:
        raise CourseNotFoundError()
    cleaned = _name(name)
    _ensure_unique(session, user_id, cleaned, course.id)
    course.name = cleaned
    course.status = _status(status)
    course.updated_at = datetime.now(timezone.utc)
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    return course_overview(session, user_id)


def delete_course(session: Session, user_id: uuid.UUID, course_id: uuid.UUID) -> dict:
    course = session.scalar(
        select(Course).where(Course.id == course_id, Course.user_id == user_id)
    )
    if course is None:
        raise CourseNotFoundError()
    session.delete(course)
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    return course_overview(session, user_id)
