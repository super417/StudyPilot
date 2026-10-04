"""Mistake-book reads and the review-status toggle (needs 6.2, 6.3, 6.5).

Listing a user's mistakes with the pending badge, fetching one detail, and
flipping the review status all share one subject, so they live together. Every
read and write is scoped to ``user_id``; a mistake the user does not own is
reported as ``NOT_FOUND`` with no leakage and no write.
"""

from datetime import datetime, timedelta, timezone
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import Mistake

VALID_REVIEW_STATUSES = ("pending", "scheduled", "done")
# Day-level Ebbinghaus rungs. After 30 days the gap doubles; no cap.
_LADDER_DAYS = (1, 2, 4, 7, 15, 30)


def interval_days(step: int) -> int:
    """Days until the next review. ``step`` is how many times it was scheduled."""
    if step < len(_LADDER_DAYS):
        return _LADDER_DAYS[step]
    return _LADDER_DAYS[-1] * (2 ** (step - (len(_LADDER_DAYS) - 1)))


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


def is_due(mistake: Mistake, now: datetime | None = None) -> bool:
    """A scheduled mistake whose next review time has arrived."""
    if mistake.review_status != "scheduled" or mistake.next_review_at is None:
        return False
    at = mistake.next_review_at
    if at.tzinfo is None:
        # SQLite drops tzinfo; values are always written in UTC.
        at = at.replace(tzinfo=timezone.utc)
    return at <= (now or datetime.now(timezone.utc))


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
    subject: str | None = None,
) -> Mistake:
    """Persist a new mistake for the user; defaults review_status to pending."""
    cleaned = (question or "").strip()
    if not cleaned:
        raise MistakeCreateValidationError()
    cleaned_subject = _subject(subject)

    def _opt(value: str | None) -> str | None:
        return _opt_text(value)

    mistake = Mistake(
        user_id=user_id,
        question=cleaned,
        my_answer=_opt(my_answer),
        why_wrong=_opt(why_wrong),
        correct_understanding=_opt(correct_understanding),
        subject=cleaned_subject,
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


def _opt_text(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


SUBJECT_MAX = 64


def _subject(value: str | None) -> str:
    text = (value or "").strip()
    if len(text) > SUBJECT_MAX:
        raise MistakeCreateValidationError(f"科目最多 {SUBJECT_MAX} 字")
    return text


def update_mistake(
    session: Session,
    user_id: uuid.UUID,
    mistake_id: uuid.UUID,
    *,
    question: str,
    my_answer: str | None = None,
    why_wrong: str | None = None,
    correct_understanding: str | None = None,
    subject: str | None = None,
) -> Mistake:
    """Overwrite content fields of a mistake the user owns."""
    cleaned = (question or "").strip()
    if not cleaned:
        raise MistakeCreateValidationError()
    cleaned_subject = _subject(subject)

    mistake = session.scalar(
        select(Mistake).where(
            Mistake.id == mistake_id, Mistake.user_id == user_id
        )
    )
    if mistake is None:
        raise MistakeNotFoundError()

    mistake.question = cleaned
    mistake.my_answer = _opt_text(my_answer)
    mistake.why_wrong = _opt_text(why_wrong)
    mistake.correct_understanding = _opt_text(correct_understanding)
    mistake.subject = cleaned_subject

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
    if status == "pending":
        mistake.review_step = 0
        mistake.next_review_at = None
    elif status == "scheduled":
        mistake.next_review_at = datetime.now(timezone.utc) + timedelta(
            days=interval_days(mistake.review_step)
        )
        mistake.review_step += 1
    else:
        mistake.next_review_at = None

    try:
        session.commit()
    except Exception:
        session.rollback()
        raise

    session.refresh(mistake)
    return mistake


def delete_mistake(
    session: Session, user_id: uuid.UUID, mistake_id: uuid.UUID
) -> None:
    """Hard-delete a mistake the user owns; foreign ids raise ``NOT_FOUND``."""
    mistake = session.scalar(
        select(Mistake).where(
            Mistake.id == mistake_id, Mistake.user_id == user_id
        )
    )
    if mistake is None:
        raise MistakeNotFoundError()
    session.delete(mistake)
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
