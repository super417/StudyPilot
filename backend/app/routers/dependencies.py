"""Shared authenticated-request dependencies."""

from fastapi import Cookie, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import User
from app.services import auth_service
from app.services.session_service import COOKIE_NAME, session_store


class AuthenticationRequiredError(Exception):
    """Raised when the in-process session cannot authenticate a request."""

    def __init__(
        self,
        code: str = "UNAUTHENTICATED",
        message: str = "authentication is required",
        *,
        clear_cookie: bool = True,
    ) -> None:
        self.code = code
        self.message = message
        self.clear_cookie = clear_cookie
        super().__init__(message)


def get_current_user(
    session: Session = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> User:
    """Resolve the current user from the process-local session store."""
    lookup = session_store.get_and_refresh(session_token)
    if lookup.expired:
        raise AuthenticationRequiredError(
            "SESSION_EXPIRED",
            "session has expired; please log in again",
        )
    if lookup.record is None:
        session_store.revoke(session_token)
        raise AuthenticationRequiredError()

    user = session.scalar(select(User).where(User.id == lookup.record.user_id))
    if user is None:
        session_store.revoke(session_token)
        raise AuthenticationRequiredError()

    auth_service.touch_user_activity(session, user)
    return user
