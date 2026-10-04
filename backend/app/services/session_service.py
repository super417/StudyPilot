from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import secrets
import sys
import uuid

from app.core.config import get_settings


COOKIE_NAME = "studypilot_session"
_SESSION_FILE = Path(__file__).resolve().parents[2] / ".sessions.json"


@dataclass
class SessionRecord:
    user_id: uuid.UUID
    last_active_at: datetime


@dataclass(frozen=True)
class SessionLookup:
    record: SessionRecord | None
    expired: bool = False


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _now(now: datetime | None) -> datetime:
    return _as_utc(now if now is not None else datetime.now(timezone.utc))


class SessionStore:
    """In-process store for the MVP authentication flow."""

    def __init__(self) -> None:
        self.sessions: dict[str, SessionRecord] = {}
        if _durable():
            self._load()

    def create(self, user_id: uuid.UUID, now: datetime | None = None) -> str:
        token = secrets.token_urlsafe(32)
        self.sessions[token] = SessionRecord(
            user_id=user_id,
            last_active_at=_now(now),
        )
        self._save()
        return token

    def get_and_refresh(
        self, token: str | None, now: datetime | None = None
    ) -> SessionLookup:
        if not token:
            return SessionLookup(None)

        record = self.sessions.get(token)
        if record is None:
            return SessionLookup(None)

        current_time = _now(now)
        last_active_at = _as_utc(record.last_active_at)
        timeout = timedelta(minutes=get_settings().session_timeout_minutes)
        if current_time - last_active_at > timeout:
            self.sessions.pop(token, None)
            return SessionLookup(None, expired=True)

        record.last_active_at = current_time
        self._save()
        return SessionLookup(record)

    # Keep the old spelling available for callers from the initial scaffold.
    def read_and_refresh(
        self, token: str | None, now: datetime | None = None
    ) -> SessionLookup:
        return self.get_and_refresh(token, now)

    def revoke(self, token: str | None) -> None:
        if token:
            self.sessions.pop(token, None)
            self._save()

    def clear(self) -> None:
        self.sessions.clear()

    def _load(self) -> None:
        if not _SESSION_FILE.exists():
            return
        try:
            raw = json.loads(_SESSION_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(raw, dict):
            return
        for token, item in raw.items():
            if not isinstance(item, dict):
                continue
            try:
                user_id = uuid.UUID(str(item["user_id"]))
                last_active_at = datetime.fromisoformat(str(item["last_active_at"]))
            except (KeyError, TypeError, ValueError):
                continue
            self.sessions[str(token)] = SessionRecord(
                user_id=user_id,
                last_active_at=_as_utc(last_active_at),
            )

    def _save(self) -> None:
        if not _durable():
            return
        payload = {
            token: {
                "user_id": str(record.user_id),
                "last_active_at": _as_utc(record.last_active_at).isoformat(),
            }
            for token, record in self.sessions.items()
        }
        try:
            _SESSION_FILE.write_text(json.dumps(payload), encoding="utf-8")
        except OSError:
            return


def _durable() -> bool:
    return "pytest" not in sys.modules


# ponytail: process-local storage is the MVP ceiling; upgrade to Redis or database-backed
# sessions when multiple workers or durable production sessions are required.
session_store = SessionStore()
