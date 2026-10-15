"""Weekly-review generation and the latest-review read (needs 7.2-7.6).

A weekly review row is the container for one natural (ISO) week — Monday
through Sunday — for one user: minutes, streak, and completion. It is created
only when that week holds at least one ``Check_In`` (requirement 7.6); an empty
week produces nothing. Mastery is not stored on the row. It is derived from
``mastery_evidence`` whenever it is read. The week-boundary math and the
completion-rate math are isolated as pure functions so they can be unit-tested
without a database.
"""

from datetime import date, datetime, timedelta, timezone
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import (
    CheckIn,
    DailyTask,
    MasteryEvidence,
    Phase,
    Plan,
    User,
    WeeklyReview,
)
from app.services.metrics_service import compute_streak


def week_bounds(day: date) -> tuple[date, date]:
    """Return the (Monday, Sunday) bounds of the natural week containing ``day``.

    Pure function: ISO weekday 1 is Monday, so ``day - (weekday - 1)`` walks
    back to Monday and Monday + 6 lands on Sunday. Handles month/year crossings
    naturally via ``timedelta``.
    """
    monday = day - timedelta(days=day.isoweekday() - 1)
    sunday = monday + timedelta(days=6)
    return monday, sunday


def completion_rate(done: int, total: int) -> int:
    """Return ``round(done / total * 100)``; a zero total is defined as 0.

    Pure function mirroring the phase-progress contract used elsewhere.
    """
    if total <= 0:
        return 0
    return round(done / total * 100)


def _now(now: datetime | None) -> datetime:
    return now if now is not None else datetime.now(timezone.utc)


_EVIDENCE_SCORE = {"correct": 100, "partial": 50, "wrong": 0}


def _evidence_day(moment: datetime | date | None) -> date | None:
    if isinstance(moment, datetime):
        return moment.date()
    if isinstance(moment, date):
        return moment
    return None


def _week_task_counts(
    session: Session,
    user_id: uuid.UUID,
    week_start: date,
    week_end: date,
) -> dict[uuid.UUID, tuple[int, int]]:
    """Done and total task counts per phase inside one week.

    Same window and the same inclusion rule as the week's completion rate:
    every task dated in the week counts, including ones carried in from
    another day. This does not read ``Phase.progress_percent``.
    """
    rows = session.execute(
        select(DailyTask.phase_id, DailyTask.status)
        .join(Plan, Plan.id == DailyTask.plan_id)
        .where(
            Plan.user_id == user_id,
            DailyTask.task_date >= week_start,
            DailyTask.task_date <= week_end,
        )
    ).all()
    counts: dict[uuid.UUID, list[int]] = {}
    for phase_id, status in rows:
        done, total = counts.get(phase_id, [0, 0])
        total += 1
        if status == "done":
            done += 1
        counts[phase_id] = [done, total]
    return {phase_id: (done, total) for phase_id, (done, total) in counts.items()}


def phase_mastery(
    session: Session,
    user_id: uuid.UUID,
    week_start: date,
    week_end: date,
) -> tuple[int | None, list[dict]]:
    """Mastery for one week, grouped by phase, from mastery_evidence only.

    correct is 100, partial is 50, wrong is 0. Rows with a null knowledge_point
    are excluded from every phase. A phase with no evidence in the week is
    returned with evidenceCount 0 and percent null. The average uses only
    phases that have evidence. When none do, the average is None: no evidence
    is not a score of 0.

    Each item also carries that phase's completion for the same week
    (``completionRate``, ``taskDone``, ``taskTotal``). No tasks in the week
    means ``completionRate`` is None, not 0.
    """
    task_counts = _week_task_counts(session, user_id, week_start, week_end)
    task_phases = session.scalars(
        select(Phase)
        .join(DailyTask, DailyTask.phase_id == Phase.id)
        .join(Plan, Plan.id == DailyTask.plan_id)
        .where(
            Plan.user_id == user_id,
            DailyTask.task_date >= week_start,
            DailyTask.task_date <= week_end,
        )
    ).all()
    phases: dict[uuid.UUID, Phase] = {phase.id: phase for phase in task_phases}

    evidence = list(
        session.scalars(
            select(MasteryEvidence).where(MasteryEvidence.user_id == user_id)
        )
    )
    by_phase: dict[uuid.UUID, list[MasteryEvidence]] = {}
    for row in evidence:
        day = _evidence_day(row.created_at)
        if day is None or day < week_start or day > week_end or row.knowledge_point is None:
            continue
        phase = phases.get(row.knowledge_point)
        if phase is None:
            phase = session.scalar(
                select(Phase)
                .join(Plan, Plan.id == Phase.plan_id)
                .where(Phase.id == row.knowledge_point, Plan.user_id == user_id)
            )
            if phase is None:
                continue
            phases[phase.id] = phase
        by_phase.setdefault(phase.id, []).append(row)

    detail: list[dict] = []
    scored: list[int] = []
    for phase in sorted(phases.values(), key=lambda item: (item.name, str(item.id))):
        done, total = task_counts.get(phase.id, (0, 0))
        completion = None if total == 0 else completion_rate(done, total)
        rows = by_phase.get(phase.id, [])
        if not rows:
            detail.append(
                {
                    "phaseId": str(phase.id),
                    "subject": phase.name,
                    "percent": None,
                    "evidenceCount": 0,
                    "completionRate": completion,
                    "taskDone": done,
                    "taskTotal": total,
                }
            )
            continue
        percent = round(sum(_EVIDENCE_SCORE.get(row.result, 0) for row in rows) / len(rows))
        percent = max(0, min(100, percent))
        scored.append(percent)
        detail.append(
            {
                "phaseId": str(phase.id),
                "subject": phase.name,
                "percent": percent,
                "evidenceCount": len(rows),
                "completionRate": completion,
                "taskDone": done,
                "taskTotal": total,
            }
        )
    if not scored:
        return None, detail
    return max(0, min(100, round(sum(scored) / len(scored)))), detail


# TODO(未来): 「周报是快照」的直觉是对的，但真正要冻结的是**已闭合的周**，
# 且必须由一个显式的「周关闭」事件写入，不能由打开页面触发。本版不做。
def generate_weekly_review(
    session: Session,
    user_id: uuid.UUID,
    week_start: date,
    week_end: date,
    now: datetime | None = None,
) -> WeeklyReview | None:
    """Get-or-create a weekly review for one user's natural week (7.2-7.6).

    Returns the existing review when one already exists for
    ``(user_id, week_start, week_end)`` — the unique constraint makes the week
    idempotent, so a repeat call never writes a second row. The row is only the
    container. Mastery is computed by :func:`phase_mastery` at read time and is
    not written here. Otherwise generates one only when the week holds at least
    one ``Check_In`` (7.6); an empty week returns ``None`` and writes nothing.
    A commit failure rolls back and re-raises.
    """
    existing = session.scalar(
        select(WeeklyReview).where(
            WeeklyReview.user_id == user_id,
            WeeklyReview.week_start == week_start,
            WeeklyReview.week_end == week_end,
        )
    )
    if existing is not None:
        return existing

    week_check_ins = list(
        session.scalars(
            select(CheckIn).where(
                CheckIn.user_id == user_id,
                CheckIn.check_date >= week_start,
                CheckIn.check_date <= week_end,
            )
        )
    )
    if not week_check_ins:
        return None

    total_minutes = sum(c.duration_minutes for c in week_check_ins)

    # Streak is the consecutive-check-in-days count anchored at the week's end,
    # over the user's full check-in history (reuses the metrics contract).
    all_check_dates = set(
        session.scalars(
            select(CheckIn.check_date)
            .where(CheckIn.user_id == user_id)
            .distinct()
        )
    )
    streak_days = compute_streak(all_check_dates, week_end)

    total_tasks = (
        session.scalar(
            select(func.count())
            .select_from(DailyTask)
            .join(Plan, Plan.id == DailyTask.plan_id)
            .where(
                Plan.user_id == user_id,
                DailyTask.task_date >= week_start,
                DailyTask.task_date <= week_end,
            )
        )
        or 0
    )
    done_tasks = (
        session.scalar(
            select(func.count())
            .select_from(DailyTask)
            .join(Plan, Plan.id == DailyTask.plan_id)
            .where(
                Plan.user_id == user_id,
                DailyTask.task_date >= week_start,
                DailyTask.task_date <= week_end,
                DailyTask.status == "done",
            )
        )
        or 0
    )
    rate = completion_rate(int(done_tasks), int(total_tasks))

    review = WeeklyReview(
        user_id=user_id,
        week_start=week_start,
        week_end=week_end,
        total_minutes=int(total_minutes),
        streak_days=int(streak_days),
        completion_rate=rate,
        created_at=_now(now),
    )
    session.add(review)

    try:
        session.commit()
    except Exception:
        session.rollback()
        raise

    session.refresh(review)
    return review


def run_weekly_generation(
    session: Session, now: datetime | None = None,
) -> list[WeeklyReview]:
    """Generate the *previous* natural week's review for every user (7.5).

    This is the callable entry point a scheduler invokes. It scans each user's
    previous natural week (relative to ``now``) and generates a review for
    those who checked in that week. Returns the reviews created or already
    present for that week.

    TODO(backend): 调度接入点 —— 由外部 cron 或 APScheduler 在每周日 24:00 后
    调用本函数；此处不自行挂载系统级 scheduler，保持可测试的纯调用入口。
    """
    reference = _now(now)
    this_monday, _ = week_bounds(reference.date())
    prev_week_start = this_monday - timedelta(days=7)
    prev_week_end = prev_week_start + timedelta(days=6)

    reviews: list[WeeklyReview] = []
    for user_id in session.scalars(select(User.id)):
        review = generate_weekly_review(
            session, user_id, prev_week_start, prev_week_end, now=now
        )
        if review is not None:
            reviews.append(review)
    return reviews


def ensure_weekly_reviews_for_user(
    session: Session,
    user_id: uuid.UUID,
    now: datetime | None = None,
) -> WeeklyReview | None:
    """Lazily generate previous/current week reviews when check-ins exist.

    Called from the latest-review read so the product can show a weekly report
    without requiring an external cron. Idempotent via generate_weekly_review.
    """
    reference = _now(now)
    this_monday, this_sunday = week_bounds(reference.date())
    prev_monday = this_monday - timedelta(days=7)
    prev_sunday = prev_monday + timedelta(days=6)

    generate_weekly_review(session, user_id, prev_monday, prev_sunday, now=now)
    generate_weekly_review(session, user_id, this_monday, this_sunday, now=now)
    return get_latest_weekly_review(session, user_id)


def get_latest_weekly_review(
    session: Session, user_id: uuid.UUID
) -> WeeklyReview | None:
    """Return the user's most recent weekly review, or ``None`` (7.1/7.5).

    Ordered by ``week_end`` then ``created_at`` descending so the freshest week
    wins; ``None`` when the user has no review yet (未满一周 / 从未生成).
    """
    return session.scalar(
        select(WeeklyReview)
        .where(WeeklyReview.user_id == user_id)
        .order_by(WeeklyReview.week_end.desc(), WeeklyReview.created_at.desc())
        .limit(1)
    )
