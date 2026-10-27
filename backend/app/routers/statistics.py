"""Learning statistics overview for the authenticated user."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import CHINA_TZ, local_today
from app.core.database import get_db
from app.models.entities import (
    CheckIn,
    DailyTask,
    MasteryEvidence,
    Mistake,
    Phase,
    User,
    UserDocument,
)
from app.routers.dependencies import get_current_user
from app.services import diagnosis_service, planner_service, remedy_service, task_service
from app.services.ai_proxy import CredentialUnavailableError, NoVerifiedApiConfigError, build_client_error
from app.services.weekly_review_service import _EVIDENCE_SCORE

router = APIRouter()


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


def _day_of(value: datetime) -> date:
    """UTC calendar day for dailyActivity (pre-batch-16 behaviour — do not change)."""
    if value.tzinfo is None:
        return value.date()
    return value.astimezone(timezone.utc).date()


def _star_day(value: datetime) -> date:
    """+8 local calendar day for the star map.

    Tasks and plans use ``local_today()`` (+8). Stars must align with that day
    boundary. Adjacent ``_day_of`` still uses UTC for ``dailyActivity`` — that
    known mismatch around 00:00–08:00 Beijing time is intentional for this batch
    (see direction.md / batch16 §3.2); do not "fix" ``_day_of`` here.
    """
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(CHINA_TZ).date()


def _star_label(answered: int, accuracy: int | None) -> str:
    if answered == 0:
        return "none"
    assert accuracy is not None
    if accuracy >= 60:
        return "gold"
    if accuracy >= 40:
        return "blue"
    return "gray"


def _build_stars(session: Session, user_id) -> list[dict]:
    today = local_today()
    start = today - timedelta(days=29)
    # Buffer one local day so UTC-stored timestamps near midnight still arrive.
    window_start = datetime.combine(
        start - timedelta(days=1), time.min, tzinfo=CHINA_TZ
    ).astimezone(timezone.utc)
    rows = session.scalars(
        select(MasteryEvidence).where(
            MasteryEvidence.user_id == user_id,
            MasteryEvidence.created_at >= window_start,
        )
    ).all()
    by_day: dict[date, list[MasteryEvidence]] = defaultdict(list)
    for row in rows:
        day = _star_day(row.created_at)
        if start <= day <= today:
            by_day[day].append(row)

    stars: list[dict] = []
    cursor = start
    while cursor <= today:
        day_rows = by_day.get(cursor, [])
        answered = len(day_rows)
        if answered == 0:
            accuracy = None
        else:
            total = sum(_EVIDENCE_SCORE.get(row.result, 0) for row in day_rows)
            accuracy = round(total / answered)
        stars.append(
            {
                "date": cursor.isoformat(),
                "answered": answered,
                "accuracy": accuracy,
                "star": _star_label(answered, accuracy),
            }
        )
        cursor += timedelta(days=1)
    return stars


def _build_route(session: Session, plan) -> list[dict]:
    if plan is None:
        return []
    phases = planner_service.list_phases_for_plan(session, plan.id)
    return [
        {
            "phaseId": str(phase.id),
            "name": phase.name,
            "index": phase.phase_index,
            "startDate": phase.start_date.isoformat(),
            "endDate": phase.end_date.isoformat(),
            "progress": task_service.phase_progress(session, phase.id),
            "isCurrent": bool(phase.is_current),
        }
        for phase in phases
    ]


def _today_task_counts(session: Session, plan) -> tuple[int, int]:
    """Return (done, total) for local today; exclude carried (same as phase_progress)."""
    if plan is None:
        return 0, 0
    today = local_today()
    tasks = list(
        session.scalars(
            select(DailyTask).where(
                DailyTask.plan_id == plan.id,
                DailyTask.task_date == today,
                DailyTask.status != "carried",
            )
        )
    )
    total = len(tasks)
    done = sum(1 for task in tasks if task.status == "done")
    return done, total


def build_overview(session: Session, user_id) -> dict:
    total_answered = (
        session.scalar(
            select(func.count())
            .select_from(MasteryEvidence)
            .where(MasteryEvidence.user_id == user_id)
        )
        or 0
    )

    study_days = (
        session.scalar(
            select(func.count(func.distinct(CheckIn.check_date))).where(
                CheckIn.user_id == user_id
            )
        )
        or 0
    )

    uploaded_docs = (
        session.scalar(
            select(func.count(func.distinct(UserDocument.doc_id))).where(
                UserDocument.user_id == user_id
            )
        )
        or 0
    )

    mistake_count = (
        session.scalar(
            select(func.count()).select_from(Mistake).where(Mistake.user_id == user_id)
        )
        or 0
    )

    phase_rows = session.execute(
        select(Phase.name, func.count())
        .select_from(MasteryEvidence)
        .join(Phase, Phase.id == MasteryEvidence.knowledge_point)
        .where(
            MasteryEvidence.user_id == user_id,
            MasteryEvidence.knowledge_point.is_not(None),
        )
        .group_by(Phase.name)
        .order_by(func.count().desc(), Phase.name)
    ).all()
    phase_total = sum(int(count) for _, count in phase_rows)
    phase_distribution = []
    for name, count in phase_rows:
        n = int(count)
        percent = round(100 * n / phase_total) if phase_total else 0
        phase_distribution.append({"name": name, "count": n, "percent": percent})

    today = _utc_today()
    start = today - timedelta(days=29)
    activity_rows = session.scalars(
        select(MasteryEvidence).where(
            MasteryEvidence.user_id == user_id,
            MasteryEvidence.created_at
            >= datetime.combine(start, time.min, tzinfo=timezone.utc),
        )
    ).all()
    by_day: dict[str, int] = defaultdict(int)
    # 堆叠柱要按掌握度结果拆开每天的量。result 有 CheckConstraint 限定为
    # correct/partial/wrong，所以三段之和恒等于 count，前端不用做归一化。
    by_day_result: dict[str, dict[str, int]] = defaultdict(
        lambda: {"correct": 0, "partial": 0, "wrong": 0}
    )
    for row in activity_rows:
        day = _day_of(row.created_at)
        if start <= day <= today:
            key = day.isoformat()
            by_day[key] += 1
            bucket = by_day_result[key]
            if row.result in bucket:
                bucket[row.result] += 1

    # 基线下方那根是**独立指标**：当天新收录的错题数，不是作答量的子集。
    # 单独统计才不会和上面的堆叠段共用一套比例尺（那样 4 条已掌握会画得比
    # 6 条未掌握还高，等于把数据说反了）。
    mistake_rows = session.scalars(
        select(Mistake).where(
            Mistake.user_id == user_id,
            Mistake.created_at
            >= datetime.combine(start, time.min, tzinfo=timezone.utc),
        )
    ).all()
    mistakes_by_day: dict[str, int] = defaultdict(int)
    for row in mistake_rows:
        day = _day_of(row.created_at)
        if start <= day <= today:
            mistakes_by_day[day.isoformat()] += 1

    daily_activity = []
    cursor = start
    while cursor <= today:
        key = cursor.isoformat()
        split = by_day_result.get(key) or {"correct": 0, "partial": 0, "wrong": 0}
        daily_activity.append(
            {
                "date": key,
                "count": by_day.get(key, 0),
                **split,
                "mistakes": mistakes_by_day.get(key, 0),
            }
        )
        cursor += timedelta(days=1)

    mastery_rows = session.execute(
        select(MasteryEvidence.result, func.count())
        .where(MasteryEvidence.user_id == user_id)
        .group_by(MasteryEvidence.result)
    ).all()
    mastery_distribution = {"correct": 0, "partial": 0, "wrong": 0}
    for result, count in mastery_rows:
        if result in mastery_distribution:
            mastery_distribution[result] = int(count)

    top_rows = session.execute(
        select(Phase.name, func.count())
        .select_from(MasteryEvidence)
        .join(Phase, Phase.id == MasteryEvidence.knowledge_point)
        .where(
            MasteryEvidence.user_id == user_id,
            MasteryEvidence.result != "correct",
            MasteryEvidence.knowledge_point.is_not(None),
        )
        .group_by(Phase.name)
        .order_by(func.count().desc(), Phase.name)
        .limit(5)
    ).all()
    top_mistakes = [{"name": name, "count": int(count)} for name, count in top_rows]

    plan = planner_service.get_latest_plan(session, user_id)
    today_done, today_total = _today_task_counts(session, plan)
    overdue_count = (
        len(remedy_service._candidates(session, plan, local_today())) if plan else 0
    )

    return {
        "status": "ok",
        "activePlanId": str(plan.id) if plan else None,
        "totalAnswered": int(total_answered),
        "studyDays": int(study_days),
        "uploadedDocs": int(uploaded_docs),
        "mistakeCount": int(mistake_count),
        "phaseDistribution": phase_distribution,
        "dailyActivity": daily_activity,
        "masteryDistribution": mastery_distribution,
        "topMistakes": top_mistakes,
        "stars": _build_stars(session, user_id),
        "route": _build_route(session, plan),
        "overdueCount": int(overdue_count),
        "todayTasksDone": int(today_done),
        "todayTasksTotal": int(today_total),
    }


@router.get("/overview")
def statistics_overview_route(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    return JSONResponse(status_code=200, content=build_overview(session, user.id))


@router.get("/diagnosis/latest")
def latest_diagnosis_route(
    user: User = Depends(get_current_user), session: Session = Depends(get_db),
) -> dict:
    return {"status": "ok", "report": diagnosis_service.latest_diagnosis(session, user.id)}


@router.post("/diagnosis")
async def generate_diagnosis_route(
    user: User = Depends(get_current_user), session: Session = Depends(get_db),
) -> JSONResponse:
    try:
        report = await diagnosis_service.generate_diagnosis(session, user.id)
    except (CredentialUnavailableError, NoVerifiedApiConfigError) as error:
        return JSONResponse(status_code=400, content=build_client_error(error))
    except diagnosis_service.DiagnosisError as error:
        return JSONResponse(status_code=400, content={
            "status": "error", "code": error.code, "message": str(error),
        })
    except (httpx.HTTPError, ValueError, TypeError):
        return JSONResponse(status_code=502, content={
            "status": "error", "code": "DIAGNOSIS_AI_FAILED", "message": "AI 暂时无法生成诊断报告，请稍后重试",
        })
    return JSONResponse(status_code=200, content={"status": "ok", "report": report})
