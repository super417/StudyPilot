"""星藤航图的读模型。三次聚合查询，星级在 Python 里现算，不加表。"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
import uuid

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.clock import CHINA_TZ, local_today
from app.models.entities import (
    CheckIn,
    DailyTask,
    MasteryEvidence,
    Phase,
    Plan,
    ReinforceTaskEvidence,
)
from app.services.journey_service import (
    MAX_RANGE_DAYS,
    CheerLine,
    DayTally,
    DayView,
    EVIDENCE_SCORE,
    best_checkin_streak,
    evidence_local_day,
    full_clear_streak,
    project_day,
    select_cheer,
    sum_stars,
)
from app.services.metrics_service import compute_streak


class JourneyValidationError(ValueError):
    """日期窗口不合法。路由把它收成 400 VALIDATION。"""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


def _parse_date(value: str | None, label: str) -> date | None:
    if value is None or value == "":
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise JourneyValidationError(f"{label}不合法") from exc


def _latest_plan(session: Session, user_id: uuid.UUID) -> Plan | None:
    return session.scalar(
        select(Plan)
        .where(Plan.user_id == user_id)
        .order_by(Plan.created_at.desc(), Plan.updated_at.desc())
        .limit(1)
    )


def _resolve_window(
    plan: Plan,
    requested_from: date | None,
    requested_to: date | None,
    today: date,
) -> tuple[date, date, date, date]:
    """返回 (响应起点, 响应终点, 查询起点, 查询终点)。

    响应窗口默认是整段计划，并且必须落在计划内、长度不超过 400 天。
    查询窗口会向左多带上一周，方便算「本周星数 / 上周同期」，
    但仍守住 400 天上限，响应窗口本身不会被裁掉。
    """
    start = requested_from or plan.start_date
    end = requested_to or plan.goal_date
    if start > end:
        raise JourneyValidationError("日期区间不合法")
    start = max(start, plan.start_date)
    end = min(end, plan.goal_date)
    if start > end:
        # 请求窗口和计划没有交集：返回空窗，而不是报错。
        return start, end, start, end
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise JourneyValidationError(f"一次最多查询 {MAX_RANGE_DAYS} 天")

    week_monday = today - timedelta(days=today.weekday())
    query_from = min(start, week_monday - timedelta(days=7), plan.start_date)
    query_to = max(end, min(today, plan.goal_date))
    if (query_to - query_from).days + 1 > MAX_RANGE_DAYS:
        query_from = max(query_from, query_to - timedelta(days=MAX_RANGE_DAYS - 1))
        query_from = min(query_from, start)
    return start, end, query_from, query_to


def _task_counts(session: Session, plan_id: uuid.UUID, start: date, end: date):
    """一天一行：总数、完成、顺延原件、待办、顺延副本、补强。"""
    reinforce_ids = select(ReinforceTaskEvidence.task_id)
    return session.execute(
        select(
            DailyTask.task_date,
            func.count().label("total"),
            func.sum(case((DailyTask.status == "done", 1), else_=0)).label("done"),
            func.sum(case((DailyTask.status == "carried", 1), else_=0)).label("carried"),
            func.sum(case((DailyTask.status == "pending", 1), else_=0)).label("pending"),
            func.sum(
                case((DailyTask.carried_from_id.is_not(None), 1), else_=0)
            ).label("carried_in"),
            func.sum(case((DailyTask.id.in_(reinforce_ids), 1), else_=0)).label(
                "reinforce"
            ),
        )
        .where(
            DailyTask.plan_id == plan_id,
            DailyTask.task_date >= start,
            DailyTask.task_date <= end,
        )
        .group_by(DailyTask.task_date)
    ).all()


def _evidence_by_local_day(
    session: Session, user_id: uuid.UUID, start: date, end: date
) -> dict[date, tuple[int, int]]:
    """按中国时区把作答收成 (得分和, 题数)。

    不在 SQL 里 ``date(created_at)``：那是 UTC 日，东八区凌晨会错位。
    先按 UTC 粗滤一天余量，再在 Python 里用 ``evidence_local_day`` 归桶。
    """
    start_utc = datetime.combine(start, time.min, tzinfo=CHINA_TZ).astimezone(
        timezone.utc
    ) - timedelta(days=1)
    end_utc = datetime.combine(end, time.min, tzinfo=CHINA_TZ).astimezone(
        timezone.utc
    ) + timedelta(days=2)
    rows = session.execute(
        select(MasteryEvidence.created_at, MasteryEvidence.result).where(
            MasteryEvidence.user_id == user_id,
            MasteryEvidence.created_at >= start_utc,
            MasteryEvidence.created_at < end_utc,
        )
    ).all()
    bucket: dict[date, list[int]] = {}
    for created_at, result in rows:
        score = EVIDENCE_SCORE.get(result)
        if score is None or created_at is None:
            continue
        day = evidence_local_day(created_at)
        if day < start or day > end:
            continue
        total, count = bucket.get(day, [0, 0])
        total += score
        count += 1
        bucket[day] = [total, count]
    return {day: (total, count) for day, (total, count) in bucket.items()}


def _checkins(session: Session, user_id: uuid.UUID) -> dict[date, int]:
    rows = session.execute(
        select(
            CheckIn.check_date,
            func.coalesce(func.sum(CheckIn.duration_minutes), 0),
        )
        .where(CheckIn.user_id == user_id)
        .group_by(CheckIn.check_date)
    ).all()
    return {day: int(minutes or 0) for day, minutes in rows}


def _build_views(
    *,
    start: date,
    end: date,
    today: date,
    counts: dict,
    evidence: dict[date, tuple[int, int]],
    checkins: dict[date, int],
    phase_ends: set[date],
) -> list[DayView]:
    views: list[DayView] = []
    if start > end:
        return views
    cursor = start
    while cursor <= end:
        row = counts.get(cursor)
        score_sum, answered = evidence.get(cursor, (0, 0))
        tags: list[str] = []
        if cursor in phase_ends:
            tags.append("boss")
        if row is not None and int(row.reinforce or 0) > 0:
            tags.append("reinforce")
        if row is not None and int(row.carried_in or 0) > 0:
            tags.append("carried")
        views.append(
            project_day(
                DayTally(
                    day=cursor,
                    total=int(row.total) if row is not None else 0,
                    done=int(row.done or 0) if row is not None else 0,
                    carried=int(row.carried or 0) if row is not None else 0,
                    pending=int(row.pending or 0) if row is not None else 0,
                    score_sum=score_sum,
                    answered=answered,
                    has_check_in=cursor in checkins,
                    minutes=checkins.get(cursor, 0),
                    tags=tuple(tags),
                ),
                today,
            )
        )
        cursor += timedelta(days=1)
    return views


def _empty_payload(today: date) -> dict:
    return {
        "status": "ok",
        "plan": None,
        "phases": [],
        "today": today.isoformat(),
        "days": [],
        "summary": {
            "streakDays": 0,
            "bestStreak": 0,
            "fullClearStreak": 0,
            "weekStars": 0,
            "lastWeekSameSpanStars": 0,
        },
    }


def _day_json(view: DayView) -> dict:
    return {
        "date": view.day.isoformat(),
        "total": view.total,
        "done": view.done,
        "carried": view.carried,
        "pending": view.pending,
        "rate": view.rate,
        "stars": view.stars,
        "accuracy": view.accuracy,
        "starColor": view.star_color,
        "hasCheckIn": view.has_check_in,
        "minutes": view.minutes,
        "tags": list(view.tags),
        "state": view.state,
        "answered": view.answered,
    }


def _summary(views: list[DayView], checkins: dict[date, int], today: date) -> dict:
    monday = today - timedelta(days=today.weekday())
    last_monday = monday - timedelta(days=7)
    last_same = today - timedelta(days=7)
    return {
        "streakDays": compute_streak(set(checkins), today),
        "bestStreak": best_checkin_streak(set(checkins), today),
        "fullClearStreak": full_clear_streak(views, today),
        "weekStars": sum_stars(views, monday, today),
        "lastWeekSameSpanStars": sum_stars(views, last_monday, last_same),
    }


def build_journey(
    session: Session,
    user_id: uuid.UUID,
    from_text: str | None,
    to_text: str | None,
    today_text: str | None,
) -> dict:
    """组装 ``GET /api/journey`` 的响应。只读，不改计划。"""
    today = _parse_date(today_text, "today") or local_today()
    requested_from = _parse_date(from_text, "from")
    requested_to = _parse_date(to_text, "to")
    plan = _latest_plan(session, user_id)
    if plan is None:
        return _empty_payload(today)

    resp_from, resp_to, query_from, query_to = _resolve_window(
        plan, requested_from, requested_to, today
    )
    if resp_from > resp_to:
        phases = list(
            session.scalars(
                select(Phase)
                .where(Phase.plan_id == plan.id)
                .order_by(Phase.phase_index)
            )
        )
        return {
            "status": "ok",
            "plan": _plan_json(plan),
            "phases": [_phase_json(phase) for phase in phases],
            "today": today.isoformat(),
            "days": [],
            "summary": _summary([], _checkins(session, user_id), today),
        }

    # 三条聚合：任务、作答、打卡。阶段行数很少，单独取，不算进这三条。
    task_rows = _task_counts(session, plan.id, query_from, query_to)
    evidence = _evidence_by_local_day(session, user_id, query_from, query_to)
    checkins = _checkins(session, user_id)
    phases = list(
        session.scalars(
            select(Phase).where(Phase.plan_id == plan.id).order_by(Phase.phase_index)
        )
    )
    phase_ends = {phase.end_date for phase in phases}
    views = _build_views(
        start=query_from,
        end=query_to,
        today=today,
        counts={row.task_date: row for row in task_rows},
        evidence=evidence,
        checkins=checkins,
        phase_ends=phase_ends,
    )
    visible = [view for view in views if resp_from <= view.day <= resp_to]
    return {
        "status": "ok",
        "plan": _plan_json(plan),
        "phases": [_phase_json(phase) for phase in phases],
        "today": today.isoformat(),
        "days": [_day_json(view) for view in visible],
        "summary": _summary(views, checkins, today),
    }


def _views_from_payload(days: list[dict]) -> list[DayView]:
    return [
        DayView(
            day=date.fromisoformat(row["date"]),
            total=row["total"],
            done=row["done"],
            carried=row["carried"],
            pending=row["pending"],
            rate=row["rate"],
            stars=row["stars"],
            accuracy=row["accuracy"],
            star_color=row["starColor"],
            has_check_in=row["hasCheckIn"],
            minutes=row["minutes"],
            tags=tuple(row.get("tags") or ()),
            state=row["state"],
            answered=int(row.get("answered") or 0),
        )
        for row in days
    ]


def cheer_to_json(line: CheerLine) -> dict:
    return {
        "status": "ok",
        "ruleId": line.rule_id,
        "text": line.text,
        "facts": line.facts,
        "source": line.source,
        "suggestRoadmap": line.suggest_roadmap,
    }


def build_cheer(
    session: Session,
    user_id: uuid.UUID,
    today_text: str | None,
    scope: str | None,
    date_text: str | None,
    exclude_text: str | None,
) -> dict:
    """鼓励语只读。计划太长时只取最近 400 天，避免一次扫完整段。"""
    if scope not in ("week", "day"):
        raise JourneyValidationError("scope 不合法")
    today = _parse_date(today_text, "today") or local_today()
    focus = _parse_date(date_text, "date") if date_text else None
    if scope == "day" and focus is None:
        raise JourneyValidationError("日期参数不合法")
    plan = _latest_plan(session, user_id)
    from_text = None
    to_text = None
    if plan is not None and (plan.goal_date - plan.start_date).days + 1 > MAX_RANGE_DAYS:
        from_text = (today - timedelta(days=MAX_RANGE_DAYS - 1)).isoformat()
        to_text = max(today, plan.start_date).isoformat()
    payload = build_journey(session, user_id, from_text, to_text, today.isoformat())
    plan_start = today
    if payload["plan"] is not None:
        plan_start = date.fromisoformat(payload["plan"]["startDate"])
    summary = payload["summary"]
    exclude = {part.strip() for part in (exclude_text or "").split(",") if part.strip()}
    line = select_cheer(
        _views_from_payload(payload["days"]),
        today=today,
        plan_start=plan_start,
        streak_days=summary["streakDays"],
        best_streak=summary["bestStreak"],
        full_clear=summary["fullClearStreak"],
        week_stars=summary["weekStars"],
        last_week_stars=summary["lastWeekSameSpanStars"],
        scope=scope,
        focus=focus,
        exclude=exclude,
    )
    return cheer_to_json(line)


def _plan_json(plan: Plan) -> dict:
    return {
        "id": str(plan.id),
        "goalName": plan.goal_name,
        "startDate": plan.start_date.isoformat(),
        "goalDate": plan.goal_date.isoformat(),
    }


def _phase_json(phase: Phase) -> dict:
    return {
        "id": str(phase.id),
        "name": phase.name,
        "startDate": phase.start_date.isoformat(),
        "endDate": phase.end_date.isoformat(),
        "index": phase.phase_index,
    }
