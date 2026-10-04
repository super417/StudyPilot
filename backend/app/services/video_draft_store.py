"""Process-local draft for a pasted study link, until the start date is confirmed.

One draft per user. A newer link replaces the previous one. Drafts older than
30 minutes are dropped. Lookup is by ``user_id``, so one user cannot read
another user's draft.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import uuid

_TTL = timedelta(minutes=30)


@dataclass
class VideoDraft:
    user_id: uuid.UUID
    material: dict
    url: str
    suggested_start: date
    created_at: datetime


class VideoDraftStore:
    def __init__(self) -> None:
        self._by_user: dict[uuid.UUID, VideoDraft] = {}

    def put(self, draft: VideoDraft) -> None:
        self._by_user[draft.user_id] = draft

    def get(self, user_id: uuid.UUID, now: datetime | None = None) -> VideoDraft | None:
        draft = self._by_user.get(user_id)
        if draft is None or draft.user_id != user_id:
            return None
        current = now or datetime.now(timezone.utc)
        created = draft.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        if current - created > _TTL:
            self._by_user.pop(user_id, None)
            return None
        return draft

    def clear(self, user_id: uuid.UUID | None = None) -> None:
        if user_id is None:
            self._by_user.clear()
            return
        self._by_user.pop(user_id, None)


video_draft_store = VideoDraftStore()
