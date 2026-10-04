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
from app.services import weekly_review_service

router = APIRouter(prefix="/api/weekly-reviews", tags=["weekly-reviews"])


def _review(session: Session, user_id, review: WeeklyReview) -> dict:
    # Live subjects, so a review saved from phase progress still shows courses.
    avg, detail = weekly_review_service.subject_mastery(
        session, user_id, review.week_start, review.week_end
    )
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
