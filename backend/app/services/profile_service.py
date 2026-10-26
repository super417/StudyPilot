"""User profile fields (nickname / direction / school / bio / assistant name)."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import User

NICKNAME_MAX = 64
DIRECTION_MAX = 128
TARGET_SCHOOL_MAX = 128
SCHOOL_MAX = 128
MAJOR_MAX = 128
BIO_MAX = 280
ASSISTANT_NAME_MAX = 32


class ProfileValidationError(ValueError):
    code = "VALIDATION"

    def __init__(self, message: str = "资料字段不合法") -> None:
        super().__init__(message)


def _clip(value: object, limit: int) -> str:
    text = "" if value is None else str(value).strip()
    if len(text) > limit:
        raise ProfileValidationError(f"字段过长（最多 {limit} 字）")
    return text


def _sanitize_assistant_name(value: object) -> str:
    """Strip, drop newlines/control chars, then apply length clip."""
    raw = "" if value is None else str(value)
    cleaned = "".join(
        ch for ch in raw if ord(ch) >= 32 and ord(ch) != 127
    )
    return _clip(cleaned, ASSISTANT_NAME_MAX)


def profile_dict(user: User) -> dict[str, str]:
    return {
        "nickname": user.nickname or "",
        "direction": user.direction or "",
        "targetSchool": user.target_school or "",
        "school": user.school or "",
        "major": user.major or "",
        "bio": user.bio or "",
        "assistantName": user.assistant_name or "",
    }


def get_profile(session: Session, user_id: uuid.UUID) -> dict[str, str]:
    user = session.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise ProfileValidationError("用户不存在")
    return profile_dict(user)


def update_profile(
    session: Session,
    user_id: uuid.UUID,
    *,
    nickname: object = None,
    direction: object = None,
    target_school: object = None,
    school: object = None,
    major: object = None,
    bio: object = None,
    assistant_name: object = None,
) -> dict[str, str]:
    user = session.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise ProfileValidationError("用户不存在")

    user.nickname = _clip(nickname, NICKNAME_MAX)
    user.direction = _clip(direction, DIRECTION_MAX)
    user.target_school = _clip(target_school, TARGET_SCHOOL_MAX)
    user.school = _clip(school, SCHOOL_MAX)
    user.major = _clip(major, MAJOR_MAX)
    user.bio = _clip(bio, BIO_MAX)
    user.assistant_name = _sanitize_assistant_name(assistant_name)

    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(user)
    return profile_dict(user)
