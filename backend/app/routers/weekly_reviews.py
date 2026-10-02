"""Weekly-review routes: latest review or empty-state marker (needs 7.1-7.6).

A single read scoped to the authenticated user. When the user has no review
yet (未满一周 / 从未生成) the endpoint returns an explicit empty-state marker
so the frontend can render its empty state (requirement 7.1/7.5).
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import User, WeeklyReview
from app.routers.dependencies import get_current_user
from app.services import planner_service, weekly_review_service

router = APIRouter(prefix="/api/weekly-reviews", tags=["weekly-reviews"])


def _phase_mastery_fallback(session: Session, user_id) -> tuple[int, list[dict]]:
    """Derive interim mastery rows from latest plan phase progress.

    Real mastery assessment is not wired yet; phase progress is an honest
    stand-in so the UI can show goal-linked subjects instead of an empty list.
    """
    plan = planner_service.get_latest_plan(session, user_id)
    if plan is None:
        return 0, []
    phases = planner_service.list_phases_for_plan(session, plan.id)
    if not phases:
        return 0, []
    detail = [
        {"subject": phase.name, "percent": int(phase.progress_percent)}
        for phase in phases
    ]
    avg = int(round(sum(item["percent"] for item in detail) / len(detail)))
    return avg, detail


def _normalize_mastery_detail(raw) -> list[dict]:
    if isinstance(raw, list):
        out: list[dict] = []
        for row in raw:
            if isinstance(row, dict) and row.get("subject") is not None:
                out.append(
                    {
                        "subject": str(row["subject"]),
                        "percent": int(row.get("percent") or 0),
                    }
                )
        return out
    if isinstance(raw, dict) and raw:
        return [
            {"subject": str(k), "percent": int(v or 0)} for k, v in raw.items()
        ]
    return []


def _review(session: Session, user_id, review: WeeklyReview) -> dict:
    detail = _normalize_mastery_detail(review.mastery_detail)
    avg = int(review.mastery_avg or 0)
    if not detail:
        avg, detail = _phase_mastery_fallback(session, user_id)
    return {
        "weekStart": review.week_start.isoformat(),
        "weekEnd": review.week_end.isoformat(),
        "totalMinutes": review.total_minutes,
        "streakDays": review.streak_days,
        "completionRate": review.completion_rate,
        "masteryAvg": avg,
        "masteryDetail": detail,
        "createdAt": review.created_at.isoformat(),
    }


@router.get("/latest")
def latest_weekly_review_route(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    # Lazy generation: create previous/current week snapshots when check-ins exist.
    review = weekly_review_service.ensure_weekly_reviews_for_user(session, user.id)
    if review is None:
        return JSONResponse(
            status_code=200,
            content={"status": "ok", "review": None, "empty": True},
        )
    return JSONResponse(
        status_code=200,
        content={"status": "ok", "review": _review(session, user.id, review)},
    )
