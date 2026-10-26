"""Persistence for the embedded resume editor's per-user document snapshot."""

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import ResumeDocument


MAX_PAYLOAD_BYTES = 4 * 1024 * 1024


class ResumeDocumentValidationError(Exception):
    """Raised when the incoming resume payload is not acceptable."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def _serialize(document: ResumeDocument) -> dict[str, str | None]:
    updated_at = document.updated_at
    if updated_at is not None and updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    return {
        "payload": document.payload,
        "updatedAt": updated_at.isoformat() if updated_at is not None else None,
    }


def get_document(session: Session, user_id: uuid.UUID) -> dict[str, str | None] | None:
    """Return the stored snapshot for the user, or ``None`` when never saved."""
    document = session.scalar(
        select(ResumeDocument).where(ResumeDocument.user_id == user_id)
    )
    return _serialize(document) if document is not None else None


def validate_payload(payload: str) -> None:
    """Reject payloads that the editor could not restore.

    The editor persists ``{"state": {"resumes": {...}}, "version": n}``; only the
    outer shape is enforced so future editor versions keep working.
    """
    if not payload:
        raise ResumeDocumentValidationError("PAYLOAD_EMPTY", "payload must not be empty")
    if len(payload.encode("utf-8")) > MAX_PAYLOAD_BYTES:
        raise ResumeDocumentValidationError(
            "PAYLOAD_TOO_LARGE", "payload exceeds the 4MB limit"
        )
    try:
        parsed = json.loads(payload)
    except (TypeError, ValueError) as error:
        raise ResumeDocumentValidationError(
            "PAYLOAD_INVALID", "payload must be valid JSON"
        ) from error
    if not isinstance(parsed, dict):
        raise ResumeDocumentValidationError(
            "PAYLOAD_INVALID", "payload must be a JSON object"
        )
    state = parsed.get("state")
    if state is not None and not isinstance(state, dict):
        raise ResumeDocumentValidationError(
            "PAYLOAD_INVALID", "payload.state must be a JSON object"
        )


def save_document(
    session: Session, user_id: uuid.UUID, payload: str
) -> dict[str, str | None]:
    """Create or replace the user's snapshot and return the stored document."""
    validate_payload(payload)
    document = session.scalar(
        select(ResumeDocument).where(ResumeDocument.user_id == user_id)
    )
    if document is None:
        document = ResumeDocument(user_id=user_id, payload=payload)
        session.add(document)
    else:
        document.payload = payload
        document.updated_at = datetime.now(timezone.utc)
    session.commit()
    session.refresh(document)
    return _serialize(document)
