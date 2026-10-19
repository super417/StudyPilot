"""Read-only direction / job / skill-gap routes over static JSON data."""

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from app.models.entities import User
from app.routers.dependencies import get_current_user
from app.services import direction_service
from app.services.direction_service import DirectionNotFoundError

router = APIRouter(prefix="/api/directions", tags=["directions"])


def _json_error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "code": code, "message": message},
    )


@router.get("")
def list_directions_route(
    _user: User = Depends(get_current_user),
) -> JSONResponse:
    return JSONResponse(
        status_code=200,
        content={"status": "ok", "directions": direction_service.list_directions()},
    )


@router.get("/{direction_id}/jobs")
def list_jobs_route(
    direction_id: str,
    _user: User = Depends(get_current_user),
) -> JSONResponse:
    try:
        payload = direction_service.list_jobs(direction_id)
    except DirectionNotFoundError as error:
        return _json_error(404, error.code, str(error))
    return JSONResponse(status_code=200, content={"status": "ok", **payload})


@router.get("/{direction_id}/skill-gap")
def skill_gap_route(
    direction_id: str,
    known: str | None = Query(default=None),
    _user: User = Depends(get_current_user),
) -> JSONResponse:
    try:
        payload = direction_service.skill_gap(direction_id, known)
    except DirectionNotFoundError as error:
        return _json_error(404, error.code, str(error))
    return JSONResponse(status_code=200, content={"status": "ok", **payload})
