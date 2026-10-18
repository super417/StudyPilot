"""Learning statistics overview for the authenticated user."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import (
    CheckIn,
    MasteryEvidence,
    Mistake,
    Phase,
    PracticeQuestion,
    User,
    UserDocument,
)
from app.routers.dependencies import get_current_user
from app.services import planner_service

router = APIRouter()


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


def _day_of(value: datetime) -> date:
    if value.tzinfo is None:
        return value.date()
    return value.astimezone(timezone.utc).date()


def build_overview(session: Session, user_id) -> dict:
    total_answered = (
        session.scalar(
            select(func.count())
            .select_from(PracticeQuestion)
            .where(
                PracticeQuestion.user_id == user_id,
                PracticeQuestion.status != "pending",
            )
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
        select(PracticeQuestion).where(
            PracticeQuestion.user_id == user_id,
            PracticeQuestion.status != "pending",
            PracticeQuestion.created_at
            >= datetime.combine(start, time.min, tzinfo=timezone.utc),
        )
    ).all()
    by_day: dict[str, int] = defaultdict(int)
    for row in activity_rows:
        day = _day_of(row.created_at)
        if start <= day <= today:
            by_day[day.isoformat()] += 1
    daily_activity = []
    cursor = start
    while cursor <= today:
        key = cursor.isoformat()
        daily_activity.append({"date": key, "count": by_day.get(key, 0)})
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
    }


@router.get("/overview")
def statistics_overview_route(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    return JSONResponse(status_code=200, content=build_overview(session, user.id))
