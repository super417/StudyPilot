"""Profile routes: read and update basic user profile fields."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import User
from app.routers.dependencies import get_current_user
from app.services import profile_service
from app.services.profile_service import ProfileValidationError

router = APIRouter(prefix="/api/profile", tags=["profile"])


def _to_camel(field_name: str) -> str:
    head, *tail = field_name.split("_")
    return head + "".join(part.title() for part in tail)


def _json_error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "code": code, "message": message},
    )


class ProfilePayload(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    nickname: str | None = None
    direction: str | None = None
    target_school: str | None = None
    bio: str | None = None


@router.get("")
def get_profile_route(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    try:
        profile = profile_service.get_profile(session, user.id)
    except ProfileValidationError as error:
        return _json_error(400, error.code, str(error))
    return JSONResponse(status_code=200, content={"status": "ok", "profile": profile})


@router.put("")
def put_profile_route(
    payload: ProfilePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    try:
        profile = profile_service.update_profile(
            session,
            user.id,
            nickname=payload.nickname,
            direction=payload.direction,
            target_school=payload.target_school,
            bio=payload.bio,
        )
    except ProfileValidationError as error:
        return _json_error(400, error.code, str(error))
    return JSONResponse(status_code=200, content={"status": "ok", "profile": profile})
