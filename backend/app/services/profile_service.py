"""User profile fields (nickname / direction / school / bio)."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import User

NICKNAME_MAX = 64
DIRECTION_MAX = 128
TARGET_SCHOOL_MAX = 128
BIO_MAX = 280


class ProfileValidationError(ValueError):
    code = "VALIDATION"

    def __init__(self, message: str = "资料字段不合法") -> None:
        super().__init__(message)


def _clip(value: object, limit: int) -> str:
    text = "" if value is None else str(value).strip()
    if len(text) > limit:
        raise ProfileValidationError(f"字段过长（最多 {limit} 字）")
    return text


def profile_dict(user: User) -> dict[str, str]:
    return {
        "nickname": user.nickname or "",
        "direction": user.direction or "",
        "targetSchool": user.target_school or "",
        "bio": user.bio or "",
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
    bio: object = None,
) -> dict[str, str]:
    user = session.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise ProfileValidationError("用户不存在")

    user.nickname = _clip(nickname, NICKNAME_MAX)
    user.direction = _clip(direction, DIRECTION_MAX)
    user.target_school = _clip(target_school, TARGET_SCHOOL_MAX)
    user.bio = _clip(bio, BIO_MAX)

    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(user)
    return profile_dict(user)
