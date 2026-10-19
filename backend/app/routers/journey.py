"""星藤航图读接口。全部现算，不写计划、不加表。"""

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import User
from app.routers.dependencies import get_current_user
from app.services.journey_query import JourneyValidationError, build_cheer, build_journey

router = APIRouter(prefix="/api", tags=["journey"])


def _json_error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "code": code, "message": message},
    )


@router.get("/journey", response_model=None)
def get_journey(
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    today: str | None = None,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict | JSONResponse:
    try:
        return build_journey(session, user.id, from_date, to_date, today)
    except JourneyValidationError as exc:
        return _json_error(400, "VALIDATION", exc.message)


@router.get("/journey/cheer", response_model=None)
def get_journey_cheer(
    today: str | None = None,
    scope: str | None = None,
    date: str | None = None,
    exclude: str | None = None,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict | JSONResponse:
    try:
        return build_cheer(session, user.id, today, scope, date, exclude)
    except JourneyValidationError as exc:
        return _json_error(400, "VALIDATION", exc.message)
