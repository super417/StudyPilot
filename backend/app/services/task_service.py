"""Daily-task reads, status toggle, and phase progress recompute (needs 16.1-16.3).

Reading a day's tasks, flipping one between ``pending`` and ``done``, and the
owning phase's progress recompute all share one subject, so they live together
here (requirement 16.2 / Properties 20). Ownership is enforced by joining through
``Plan.user_id``; a task the user does not own is reported as ``NOT_FOUND`` with
no leakage and no write.
"""

from datetime import date
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import DailyTask, Phase, Plan

VALID_STATUSES = ("pending", "done")


class TaskStatusValidationError(ValueError):
    """Raised when the requested status is not ``pending`` or ``done``."""

    code = "VALIDATION"

    def __init__(self, message: str = "任务状态不合法") -> None:
        super().__init__(message)


class TaskNotFoundError(ValueError):
    """Raised when a task id does not resolve to a task the user owns.

    A foreign task is reported exactly like an unknown one, so ownership
    failures never disclose whether the id exists.
    """

    code = "NOT_FOUND"

    def __init__(self, message: str = "任务不存在") -> None:
        super().__init__(message)


def recompute_phase_progress(session: Session, phase: Phase) -> None:
    """Set ``phase.progress_percent`` from the done/total task ratio.

    ``progress = round(done / total * 100)`` over the phase's daily tasks; an
    empty phase (total 0) is defined as 0. Pure recompute — the caller owns the
    commit.
    """
    total = session.scalar(
        select(func.count()).select_from(DailyTask).where(DailyTask.phase_id == phase.id)
    ) or 0
    if total == 0:
        phase.progress_percent = 0
        return
    done = session.scalar(
        select(func.count())
        .select_from(DailyTask)
        .where(DailyTask.phase_id == phase.id, DailyTask.status == "done")
    ) or 0
    phase.progress_percent = round(done / total * 100)


def set_task_status(
    session: Session,
    user_id: uuid.UUID,
    task_id: uuid.UUID,
    status: str,
) -> tuple[DailyTask, Phase]:
    """Set a task's status and recompute its owning phase's progress (16.2).

    Validates ``status`` first, then confirms the task belongs to the user by
    joining through ``Plan.user_id``. Both directions (pending↔done) trigger a
    fresh recompute of the phase progress. A commit failure rolls back and
    re-raises so the task and phase stay consistent.
    """
    if status not in VALID_STATUSES:
        raise TaskStatusValidationError()

    task = session.scalar(
        select(DailyTask)
        .join(Plan, Plan.id == DailyTask.plan_id)
        .where(DailyTask.id == task_id, Plan.user_id == user_id)
    )
    if task is None:
        raise TaskNotFoundError()

    phase = session.scalar(select(Phase).where(Phase.id == task.phase_id))
    if phase is None:
        # A task always has a phase; treat a dangling reference as not found.
        raise TaskNotFoundError()

    task.status = status
    session.flush()
    recompute_phase_progress(session, phase)

    try:
        session.commit()
    except Exception:
        session.rollback()
        raise

    session.refresh(task)
    session.refresh(phase)
    return task, phase


def get_daily_tasks(
    session: Session, user_id: uuid.UUID, task_date: date
) -> list[DailyTask]:
    """Return the user's daily tasks on ``task_date`` across all their plans.

    ``Daily_Task`` has no ``user_id``; ownership is enforced by joining through
    ``Plan.user_id``, so another user's tasks are never returned. Ordering is
    stable: by owning phase index, then task date, then id.
    """
    statement = (
        select(DailyTask)
        .join(Plan, Plan.id == DailyTask.plan_id)
        .join(Phase, Phase.id == DailyTask.phase_id)
        .where(Plan.user_id == user_id, DailyTask.task_date == task_date)
        .order_by(Phase.phase_index, DailyTask.task_date, DailyTask.id)
    )
    return list(session.scalars(statement))
