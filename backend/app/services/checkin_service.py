"""Check-in writes (needs 4.6, 4.7, 11.3).

A check-in is validated (duration positive, difficulty/energy in [1, 5]) before
any write — invalid input raises :class:`CheckInValidationError` (code
``VALIDATION``) and never touches the database.

Daily-task reads live in ``task_service`` alongside the status toggle they
share a subject with.
"""

from datetime import date
import uuid

from sqlalchemy.orm import Session

from app.models.entities import CheckIn


class CheckInValidationError(ValueError):
    """Raised when check-in fields fall outside their allowed ranges.

    Carries the generic ``VALIDATION`` code so the route can map it to a 400
    without leaking which specific field failed.
    """

    code = "VALIDATION"

    def __init__(self, message: str = "打卡数据不合法") -> None:
        super().__init__(message)


def _validate(duration_minutes: int, difficulty: int, energy: int) -> None:
    """Guard the numeric ranges before writing. Rejects bools explicitly."""
    if isinstance(duration_minutes, bool) or not isinstance(duration_minutes, int):
        raise CheckInValidationError()
    if isinstance(difficulty, bool) or not isinstance(difficulty, int):
        raise CheckInValidationError()
    if isinstance(energy, bool) or not isinstance(energy, int):
        raise CheckInValidationError()
    if duration_minutes <= 0:
        raise CheckInValidationError()
    if not (1 <= difficulty <= 5):
        raise CheckInValidationError()
    if not (1 <= energy <= 5):
        raise CheckInValidationError()


def create_check_in(
    session: Session,
    user_id: uuid.UUID,
    check_date: date,
    duration_minutes: int,
    difficulty: int,
    energy: int,
    note: str | None = None,
) -> CheckIn:
    """Validate and persist one check-in for the user (requirement 16.1).

    Invalid ranges raise :class:`CheckInValidationError` before any write, so a
    rejected check-in leaves the database untouched. A commit failure rolls back
    and re-raises so no partial row survives.
    """
    _validate(duration_minutes, difficulty, energy)

    check_in = CheckIn(
        user_id=user_id,
        check_date=check_date,
        duration_minutes=duration_minutes,
        difficulty=difficulty,
        energy=energy,
        note=note,
    )
    session.add(check_in)
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise

    session.refresh(check_in)
    return check_in
