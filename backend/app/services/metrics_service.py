"""Metrics_Service: purely derived learning metrics (needs 15.1-15.6, 16.3).

No new persistence — every figure is read from ``Check_Ins`` / ``Plans`` /
``Phases`` and derived. Natural-day boundaries use the *user's local date*,
which the caller supplies as ``today`` (requirement 15.6). The two pieces of
non-trivial logic — the streak walk-back and the today three-state mapping —
are isolated as pure functions so they can be unit-tested without a database.
"""

from dataclasses import dataclass
from datetime import date, timedelta
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import CheckIn, DailyTask, Phase, Plan

# Today three-state labels (requirement 4.4 / 16.3).
TODAY_STATUS_NO_TASK = "未反馈"
TODAY_STATUS_SCHEDULED = "已安排"
TODAY_STATUS_COMPLETED = "已完成"


def compute_streak(dates: set[date], today: date) -> int:
    """Consecutive check-in days ending at/before ``today`` (requirement 15.3).

    Start the cursor at ``today`` if it was a check-in day, else at the most
    recent check-in day on or before ``today`` (later days never seed the
    walk-back). Then count backwards one day at a time, stopping at the first
    gap. An empty set yields 0.
    """
    if not dates:
        return 0

    if today in dates:
        cursor = today
    else:
        earlier = [d for d in dates if d <= today]
        if not earlier:
            return 0
        cursor = max(earlier)

    streak = 0
    while cursor in dates:
        streak += 1
        cursor = cursor - timedelta(days=1)
    return streak


def classify_today(has_task: bool, has_checkin: bool) -> str:
    """Map (has Daily_Task today, has Check_In today) to the three states.

    No task -> 未反馈; task but no check-in -> 已安排; task and check-in ->
    已完成 (requirement 16.3). A check-in with no task still reads 未反馈: the
    state is anchored on whether the day was scheduled.
    """
    if not has_task:
        return TODAY_STATUS_NO_TASK
    if has_checkin:
        return TODAY_STATUS_COMPLETED
    return TODAY_STATUS_SCHEDULED


@dataclass(frozen=True)
class OverviewMetrics:
    """The four overview metrics plus today's three-state label."""

    total_minutes: int
    streak_days: int
    remaining_days: int
    phase_progress_completed: int
    phase_progress_total: int
    today_status: str


def _latest_plan(session: Session, user_id: uuid.UUID) -> Plan | None:
    """The user's most recent plan by created_at (updated_at breaks ties)."""
    return session.scalar(
        select(Plan)
        .where(Plan.user_id == user_id)
        .order_by(Plan.created_at.desc(), Plan.updated_at.desc())
        .limit(1)
    )


def compute_overview(
    session: Session, user_id: uuid.UUID, today: date
) -> OverviewMetrics:
    """Derive the overview metrics for ``user_id`` as of local ``today``.

    - ``total_minutes`` = SUM of the user's check-in durations (15.1).
    - ``streak_days`` = :func:`compute_streak` over distinct check-in dates (15.3).
    - ``remaining_days`` = ``max(0, goal_date - today)`` for the latest plan;
      0 when the user has no plan (15.4).
    - ``phase_progress`` = (count of is_completed phases, latest plan's
      total_phases); (0, 0) with no plan (15.5).
    - ``today_status`` = three-state map from today's task/check-in presence (16.3).
    """
    total_minutes = session.scalar(
        select(func.coalesce(func.sum(CheckIn.duration_minutes), 0)).where(
            CheckIn.user_id == user_id
        )
    ) or 0

    check_dates = set(
        session.scalars(
            select(CheckIn.check_date).where(CheckIn.user_id == user_id).distinct()
        )
    )
    streak_days = compute_streak(check_dates, today)

    plan = _latest_plan(session, user_id)
    if plan is None:
        remaining_days = 0
        completed = 0
        total_phases = 0
    else:
        remaining_days = max(0, (plan.goal_date - today).days)
        total_phases = plan.total_phases
        completed = session.scalar(
            select(func.count())
            .select_from(Phase)
            .where(Phase.plan_id == plan.id, Phase.is_completed.is_(True))
        ) or 0

    has_task = (
        session.scalar(
            select(func.count())
            .select_from(DailyTask)
            .join(Plan, Plan.id == DailyTask.plan_id)
            .where(Plan.user_id == user_id, DailyTask.task_date == today)
        )
        or 0
    ) > 0
    has_checkin = today in check_dates
    today_status = classify_today(has_task, has_checkin)

    return OverviewMetrics(
        total_minutes=int(total_minutes),
        streak_days=streak_days,
        remaining_days=remaining_days,
        phase_progress_completed=int(completed),
        phase_progress_total=int(total_phases),
        today_status=today_status,
    )
