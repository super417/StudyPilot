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


class NoPlanError(ValueError):
    """Raised when the user has no plan to attach a task to."""

    code = "NO_PLAN"

    def __init__(self, message: str = "还没有规划，无法补任务") -> None:
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
    """Set ``phase.progress_percent`` / completion, then advance ``is_current``.

    ``progress = round(done / total * 100)`` over the phase's daily tasks; an
    empty phase (total 0) is defined as 0 and not completed. When every task is
    done the phase becomes completed; the first incomplete phase on the same
    plan becomes current. Pure recompute — the caller owns the commit.
    """
    total = session.scalar(
        select(func.count()).select_from(DailyTask).where(DailyTask.phase_id == phase.id)
    ) or 0
    if total == 0:
        phase.progress_percent = 0
        phase.is_completed = False
    else:
        done = session.scalar(
            select(func.count())
            .select_from(DailyTask)
            .where(DailyTask.phase_id == phase.id, DailyTask.status == "done")
        ) or 0
        phase.progress_percent = round(done / total * 100)
        phase.is_completed = phase.progress_percent == 100
    session.flush()
    sync_plan_current_phase(session, phase.plan_id)


def sync_plan_current_phase(session: Session, plan_id: uuid.UUID) -> None:
    """Mark the first incomplete phase as current; if all done, keep the last."""
    phases = list(
        session.scalars(
            select(Phase).where(Phase.plan_id == plan_id).order_by(Phase.phase_index)
        )
    )
    if not phases:
        return
    current = next((p for p in phases if not p.is_completed), phases[-1])
    for phase in phases:
        phase.is_current = phase.id == current.id
    session.flush()


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


def add_today_task(
    session: Session,
    user_id: uuid.UUID,
    task_date: date,
    description: str | None = None,
) -> tuple[DailyTask, bool]:
    """Add one pending task on the latest plan for ``task_date``.

    Returns ``(task, created)``. A task already on that date is returned as-is
    so a double click does not insert a second row. Progress is recomputed
    because the new pending task changes the phase ratio.
    """
    plan = session.scalar(
        select(Plan)
        .where(Plan.user_id == user_id)
        .order_by(Plan.created_at.desc(), Plan.updated_at.desc())
        .limit(1)
    )
    if plan is None:
        raise NoPlanError()

    existing = session.scalar(
        select(DailyTask)
        .where(DailyTask.plan_id == plan.id, DailyTask.task_date == task_date)
        .order_by(DailyTask.id)
        .limit(1)
    )
    if existing is not None:
        return existing, False

    phase = session.scalar(
        select(Phase)
        .where(Phase.plan_id == plan.id)
        .order_by(Phase.is_current.desc(), Phase.phase_index)
        .limit(1)
    )
    if phase is None:
        raise NoPlanError()

    text = (description or "").strip() or f"推进当前阶段：{phase.name}"
    task = DailyTask(
        plan_id=plan.id,
        phase_id=phase.id,
        task_date=task_date,
        week_label=f"W{task_date.isocalendar().week:02d}",
        description=text,
        status="pending",
    )
    session.add(task)
    session.flush()
    recompute_phase_progress(session, phase)
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(task)
    return task, True


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
