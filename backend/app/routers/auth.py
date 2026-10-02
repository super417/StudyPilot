from fastapi import APIRouter, Cookie, Depends, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import User
from app.services import auth_service
from app.services.auth_service import (
    AuthValidationError,
    InvalidCredentialsError,
    LockedAccountError,
    UsernameTakenError,
)
from app.services.session_service import COOKIE_NAME, session_store


router = APIRouter(prefix="/api/auth", tags=["auth"])
DATA_LOAD_FAILURE_MESSAGE = "数据加载失败，请稍后重试"


class Credentials(BaseModel):
    username: str | None = None
    password: str | None = None


def _json_error(status_code: int, code: str, message: str, **extra):
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "code": code, "message": message, **extra},
    )


def _data_load_result(session: Session, user: User) -> dict:
    try:
        return {"status": "ok", "data": auth_service.load_user_data(session, user)}
    except Exception:
        return {
            "status": "degraded",
            "code": "DATA_LOAD_FAILED",
            "message": DATA_LOAD_FAILURE_MESSAGE,
        }


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME)


@router.post("/register", status_code=201)
def register(payload: Credentials, session: Session = Depends(get_db)) -> dict:
    try:
        user = auth_service.register_user(session, payload.username, payload.password)
    except AuthValidationError as error:
        return _json_error(400, "VALIDATION", str(error))
    except UsernameTakenError as error:
        return _json_error(409, "USERNAME_TAKEN", str(error))

    return {"status": "ok", "userId": str(user.id)}


@router.post("/login")
def login(
    payload: Credentials,
    response: Response,
    session: Session = Depends(get_db),
) -> dict:
    try:
        user = auth_service.authenticate_user(
            session, payload.username, payload.password
        )
    except InvalidCredentialsError as error:
        return _json_error(401, "INVALID_CREDENTIALS", str(error))
    except LockedAccountError as error:
        return _json_error(
            423,
            "LOCKED",
            str(error),
            retryAfterSeconds=int(error.retry_after_seconds),
        )

    token = session_store.create(user.id)
    auth_service.touch_user_activity(session, user)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
    )
    return {
        "status": "ok",
        "userId": str(user.id),
        "dataLoad": _data_load_result(session, user),
    }


@router.post("/logout")
def logout(
    response: Response,
    session_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
    _session: Session = Depends(get_db),
) -> dict:
    session_store.revoke(session_token)
    _clear_session_cookie(response)
    return {"status": "ok"}


@router.get("/me")
def me(
    response: Response,
    session_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
    session: Session = Depends(get_db),
):
    lookup = session_store.get_and_refresh(session_token)
    if lookup.expired:
        expired_response = _json_error(
            401,
            "SESSION_EXPIRED",
            "session has expired; please log in again",
        )
        expired_response.delete_cookie(COOKIE_NAME)
        return expired_response
    if lookup.record is None:
        return _json_error(401, "UNAUTHENTICATED", "authentication is required")

    user = session.scalar(select(User).where(User.id == lookup.record.user_id))
    if user is None:
        session_store.revoke(session_token)
        unauthenticated_response = _json_error(
            401, "UNAUTHENTICATED", "authentication is required"
        )
        unauthenticated_response.delete_cookie(COOKIE_NAME)
        return unauthenticated_response

    auth_service.touch_user_activity(session, user)
    return {
        "status": "ok",
        "userId": str(user.id),
        "dataLoad": _data_load_result(session, user),
    }
