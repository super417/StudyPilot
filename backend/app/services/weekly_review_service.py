"""Weekly-review generation and the latest-review read (needs 7.2-7.6).

A weekly review is a persisted snapshot of one natural (ISO) week — Monday
through Sunday — for one user. It is generated only when that week holds at
least one ``Check_In`` (requirement 7.6); an empty week produces nothing. The
natural-week boundary math and the completion-rate math are isolated as pure
functions so they can be unit-tested without a database.
"""

from datetime import date, datetime, timedelta, timezone
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import CheckIn, Course, DailyTask, Phase, Plan, User, WeeklyReview
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


def subject_mastery(
    session: Session,
    user_id: uuid.UUID,
    week_start: date,
    week_end: date,
) -> tuple[int, list[dict]]:
    """Per-course mastery for one week: matching task completion, not phase progress.

    A task matches a course when the course name appears in the phase name or
    the task description. ponytail: substring match, same ceiling as the course
    card; a short name inside a longer one can share tasks.
    """
    courses = list(
        session.scalars(
            select(Course)
            .where(Course.user_id == user_id)
            .order_by(Course.name)
        )
    )
    if not courses:
        return 0, []
    rows = session.execute(
        select(DailyTask, Phase)
        .join(Plan, Plan.id == DailyTask.plan_id)
        .join(Phase, Phase.id == DailyTask.phase_id)
        .where(
            Plan.user_id == user_id,
            DailyTask.task_date >= week_start,
            DailyTask.task_date <= week_end,
        )
    ).all()
    detail: list[dict] = []
    for course in courses:
        matched = [
            task
            for task, phase in rows
            if course.name in phase.name or course.name in task.description
        ]
        done = sum(1 for task in matched if task.status == "done")
        detail.append(
            {"subject": course.name, "percent": completion_rate(done, len(matched))}
        )
    avg = int(round(sum(item["percent"] for item in detail) / len(detail)))
    return avg, detail


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
    idempotent, so a repeat call never writes a second row. Otherwise generates
    one only when the week holds at least one ``Check_In`` (7.6); an empty week
    returns ``None`` and writes nothing. A commit failure rolls back and
    re-raises.
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
    mastery_avg, mastery_detail = subject_mastery(
        session, user_id, week_start, week_end
    )

    review = WeeklyReview(
        user_id=user_id,
        week_start=week_start,
        week_end=week_end,
        total_minutes=int(total_minutes),
        streak_days=int(streak_days),
        completion_rate=rate,
        mastery_avg=mastery_avg,
        mastery_detail=mastery_detail,
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
