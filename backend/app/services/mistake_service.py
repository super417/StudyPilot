"""Mistake-book reads and the review-status toggle (needs 6.2, 6.3, 6.5).

Listing a user's mistakes with the pending badge, fetching one detail, and
flipping the review status all share one subject, so they live together. Every
read and write is scoped to ``user_id``; a mistake the user does not own is
reported as ``NOT_FOUND`` with no leakage and no write.
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import Mistake

VALID_REVIEW_STATUSES = ("pending", "scheduled", "done")


class MistakeReviewStatusValidationError(ValueError):
    """Raised when the requested review status is not one of the valid values."""

    code = "VALIDATION"

    def __init__(self, message: str = "复习状态不合法") -> None:
        super().__init__(message)


class MistakeNotFoundError(ValueError):
    """Raised when a mistake id does not resolve to one the user owns.

    A foreign mistake is reported exactly like an unknown one, so ownership
    failures never disclose whether the id exists.
    """

    code = "NOT_FOUND"

    def __init__(self, message: str = "错题不存在") -> None:
        super().__init__(message)


def list_mistakes(
    session: Session, user_id: uuid.UUID
) -> tuple[list[Mistake], int]:
    """Return the user's mistakes and the pending-review badge count (6.2).

    Ordering is stable: newest first by ``created_at``, ``id`` breaking ties.
    The badge is the number of the user's mistakes whose ``review_status`` is
    ``pending`` (Property 9), counted independently of the list contents.
    """
    mistakes = list(
        session.scalars(
            select(Mistake)
            .where(Mistake.user_id == user_id)
            .order_by(Mistake.created_at.desc(), Mistake.id)
        )
    )
    pending_count = (
        session.scalar(
            select(func.count())
            .select_from(Mistake)
            .where(Mistake.user_id == user_id, Mistake.review_status == "pending")
        )
        or 0
    )
    return mistakes, int(pending_count)


def get_mistake(
    session: Session, user_id: uuid.UUID, mistake_id: uuid.UUID
) -> Mistake:
    """Return a single mistake the user owns, or raise ``NOT_FOUND`` (6.3)."""
    mistake = session.scalar(
        select(Mistake).where(
            Mistake.id == mistake_id, Mistake.user_id == user_id
        )
    )
    if mistake is None:
        raise MistakeNotFoundError()
    return mistake


class MistakeCreateValidationError(ValueError):
    """Raised when required mistake fields are missing or blank."""

    code = "VALIDATION"

    def __init__(self, message: str = "请填写原题内容") -> None:
        super().__init__(message)


def create_mistake(
    session: Session,
    user_id: uuid.UUID,
    *,
    question: str,
    my_answer: str | None = None,
    why_wrong: str | None = None,
    correct_understanding: str | None = None,
) -> Mistake:
    """Persist a new mistake for the user; defaults review_status to pending."""
    cleaned = (question or "").strip()
    if not cleaned:
        raise MistakeCreateValidationError()

    def _opt(value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        return text or None

    mistake = Mistake(
        user_id=user_id,
        question=cleaned,
        my_answer=_opt(my_answer),
        why_wrong=_opt(why_wrong),
        correct_understanding=_opt(correct_understanding),
        review_status="pending",
    )
    session.add(mistake)
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(mistake)
    return mistake


def set_review_status(
    session: Session,
    user_id: uuid.UUID,
    mistake_id: uuid.UUID,
    status: str,
) -> Mistake:
    """Update a mistake's review status after ownership + value checks (6.5).

    Validates ``status`` first, then confirms ownership. A commit failure rolls
    back and re-raises so the row stays consistent.
    """
    if status not in VALID_REVIEW_STATUSES:
        raise MistakeReviewStatusValidationError()

    mistake = session.scalar(
        select(Mistake).where(
            Mistake.id == mistake_id, Mistake.user_id == user_id
        )
    )
    if mistake is None:
        raise MistakeNotFoundError()

    mistake.review_status = status

    try:
        session.commit()
    except Exception:
        session.rollback()
        raise

    session.refresh(mistake)
    return mistake
