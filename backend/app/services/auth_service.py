from datetime import datetime, timedelta, timezone
from math import ceil

from passlib.context import CryptContext
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.entities import (
    ApiConfig,
    CheckIn,
    Mistake,
    Plan,
    User,
    WeeklyReview,
)


_password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class AuthValidationError(ValueError):
    code = "VALIDATION"


class UsernameTakenError(ValueError):
    code = "USERNAME_TAKEN"

    def __init__(self, message: str = "username is already taken") -> None:
        super().__init__(message)


class InvalidCredentialsError(ValueError):
    code = "INVALID_CREDENTIALS"

    def __init__(self, message: str = "invalid credentials") -> None:
        super().__init__(message)


class LockedAccountError(ValueError):
    code = "LOCKED"

    def __init__(self, retry_after_seconds: int) -> None:
        self.retry_after_seconds = retry_after_seconds
        super().__init__("account is locked")


MAX_LOGIN_FAILURES = 5
LOCK_DURATION = timedelta(minutes=15)


def _validation_error(field: str, message: str) -> AuthValidationError:
    return AuthValidationError(f"{field} {message}")


def validate_registration(username: str, password: str) -> None:
    if username is None or not username.strip():
        raise _validation_error("username", "must not be empty")
    if len(username) < 3 or len(username) > 64:
        raise _validation_error("username", "length must be between 3 and 64 characters")
    if password is None or not password.strip():
        raise _validation_error("password", "must not be empty")
    if len(password) < 8 or len(password) > 128:
        raise _validation_error("password", "length must be between 8 and 128 characters")


def hash_password(password: str) -> str:
    return _password_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bool(_password_context.verify(password, password_hash))
    except Exception:
        return False


def _is_username_unique_violation(error: IntegrityError) -> bool:
    constraint_name = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
    if constraint_name and "username" in constraint_name.lower():
        return True

    message = str(error.orig).lower()
    return "username" in message and ("unique" in message or "duplicate" in message)


def register_user(session: Session, username: str, password: str) -> User:
    validate_registration(username, password)

    existing_user = session.scalar(select(User).where(User.username == username))
    if existing_user is not None:
        raise UsernameTakenError()

    user = User(username=username, password_hash=hash_password(password))
    session.add(user)
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        if _is_username_unique_violation(error):
            raise UsernameTakenError() from error
        raise

    session.refresh(user)
    return user


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _commit_auth_state(session: Session) -> None:
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise


def authenticate_user(
    session: Session,
    username: str,
    password: str,
    now: datetime | None = None,
) -> User:
    current_time = _as_utc(now if now is not None else datetime.now(timezone.utc))
    user = session.scalar(select(User).where(User.username == username))
    if user is None:
        raise InvalidCredentialsError()

    locked_until = (
        _as_utc(user.locked_until) if user.locked_until is not None else None
    )
    if locked_until is not None and locked_until > current_time:
        retry_after_seconds = max(1, ceil((locked_until - current_time).total_seconds()))
        raise LockedAccountError(retry_after_seconds)

    if locked_until is not None:
        user.locked_until = None
        user.failed_login_count = 0

    if not verify_password(password, user.password_hash):
        user.failed_login_count += 1
        if user.failed_login_count >= MAX_LOGIN_FAILURES:
            user.locked_until = current_time + LOCK_DURATION
            _commit_auth_state(session)
            raise LockedAccountError(int(LOCK_DURATION.total_seconds()))

        _commit_auth_state(session)
        raise InvalidCredentialsError()

    user.failed_login_count = 0
    user.locked_until = None
    _commit_auth_state(session)
    return user


def touch_user_activity(
    session: Session, user: User, now: datetime | None = None
) -> User:
    """Refresh the user's activity timestamp and persist it atomically."""
    user.last_active_at = _as_utc(now if now is not None else datetime.now(timezone.utc))
    _commit_auth_state(session)
    return user


def _count_user_rows(session: Session, model: type, user_id) -> int:
    return int(
        session.scalar(
            select(func.count()).select_from(model).where(model.user_id == user_id)
        )
        or 0
    )


def load_user_data(session: Session, user: User) -> dict:
    """Return a JSON-safe summary without credentials or encrypted secrets."""
    api_config = session.scalar(
        select(ApiConfig).where(ApiConfig.user_id == user.id)
    )
    return {
        "apiConfig": {
            "configured": api_config is not None,
            "isVerified": bool(api_config.is_verified) if api_config else False,
        },
        "plans": _count_user_rows(session, Plan, user.id),
        "checkIns": _count_user_rows(session, CheckIn, user.id),
        "mistakes": _count_user_rows(session, Mistake, user.id),
        "weeklyReviews": _count_user_rows(session, WeeklyReview, user.id),
    }
