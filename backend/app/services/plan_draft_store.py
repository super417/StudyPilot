"""In-memory plan-draft store for the planner clarify state machine (needs 9.3-9.5).

A *draft* accumulates the known goal fields for a single learning goal and
tracks the clarify *round* counter. One round = one "system question + user
reply" cycle. The store is process-local, mirroring ``session_service`` — good
enough for the MVP and easy to reset in tests.

Security: every lookup/update/delete requires the owning ``user_id``; a draft
belonging to another user is treated as not found so a caller can never advance
or read someone else's draft.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import secrets
import uuid

# Requirement 9.3/9.5: the clarify loop is bounded to at most 3 rounds. After
# the 3rd round the planner generates from whatever information it has.
MAX_CLARIFY_ROUNDS = 3


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class PlanDraft:
    """One in-progress goal: merged known fields plus the clarify round."""

    user_id: uuid.UUID
    fields: dict[str, object] = field(default_factory=dict)
    round: int = 1
    created_at: datetime = field(default_factory=_utc_now)
    document_ids: list[str] | None = None
    pending: dict | None = None
    used_docs: list[str] = field(default_factory=list)


class PlanDraftStore:
    """Process-local store keyed by an opaque draft id."""

    def __init__(self) -> None:
        self._drafts: dict[str, PlanDraft] = {}

    def create(self, user_id: uuid.UUID, fields: dict[str, object]) -> str:
        """Create a draft at round 1 with the supplied known fields."""
        draft_id = secrets.token_urlsafe(24)
        self._drafts[draft_id] = PlanDraft(user_id=user_id, fields=dict(fields))
        return draft_id

    def get(self, draft_id: str | None, user_id: uuid.UUID) -> PlanDraft | None:
        """Return the draft only when it exists and belongs to ``user_id``."""
        if not draft_id:
            return None
        draft = self._drafts.get(draft_id)
        if draft is None or draft.user_id != user_id:
            return None
        return draft

    def merge_fields(
        self, draft: PlanDraft, updates: dict[str, object]
    ) -> dict[str, object]:
        """Merge non-empty supplied fields into the draft's known fields."""
        for key, value in updates.items():
            if value is not None:
                draft.fields[key] = value
        return draft.fields

    def advance_round(self, draft: PlanDraft) -> int:
        """Increment and return the clarify round counter."""
        draft.round += 1
        return draft.round

    def delete(self, draft_id: str | None) -> None:
        """Drop a draft; used once a plan is generated (or on cleanup)."""
        if draft_id:
            self._drafts.pop(draft_id, None)

    def clear(self) -> None:
        """Remove every draft; primarily a test hook."""
        self._drafts.clear()


plan_draft_store = PlanDraftStore()
