"""User notes: list, create, update, delete."""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Note

TITLE_MAX = 120
SUBJECT_MAX = 64


class NoteValidationError(ValueError):
    code = "VALIDATION"

    def __init__(self, message: str = "笔记内容不合法") -> None:
        super().__init__(message)


class NoteNotFoundError(ValueError):
    code = "NOT_FOUND"

    def __init__(self, message: str = "笔记不存在") -> None:
        super().__init__(message)


def _title(value: object) -> str:
    text = "" if value is None else str(value).strip()
    if not text:
        raise NoteValidationError("请填写笔记标题")
    if len(text) > TITLE_MAX:
        raise NoteValidationError(f"标题最多 {TITLE_MAX} 字")
    return text


def _subject(value: object) -> str:
    text = "" if value is None else str(value).strip()
    if len(text) > SUBJECT_MAX:
        raise NoteValidationError(f"科目最多 {SUBJECT_MAX} 字")
    return text


def _body(value: object) -> str:
    return "" if value is None else str(value).strip()


def note_dict(note: Note) -> dict:
    return {
        "id": str(note.id),
        "title": note.title,
        "subject": note.subject or "",
        "body": note.body or "",
        "updatedAt": note.updated_at.isoformat(),
        "createdAt": note.created_at.isoformat(),
    }


def list_notes(session: Session, user_id: uuid.UUID) -> list[dict]:
    rows = session.scalars(
        select(Note)
        .where(Note.user_id == user_id)
        .order_by(Note.updated_at.desc(), Note.id)
    )
    return [note_dict(row) for row in rows]


def create_note(
    session: Session,
    user_id: uuid.UUID,
    *,
    title: object,
    subject: object = "",
    body: object = "",
) -> dict:
    now = datetime.now(timezone.utc)
    note = Note(
        user_id=user_id,
        title=_title(title),
        subject=_subject(subject),
        body=_body(body),
        created_at=now,
        updated_at=now,
    )
    session.add(note)
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(note)
    return note_dict(note)


def update_note(
    session: Session,
    user_id: uuid.UUID,
    note_id: uuid.UUID,
    *,
    title: object,
    subject: object = "",
    body: object = "",
) -> dict:
    note = session.scalar(
        select(Note).where(Note.id == note_id, Note.user_id == user_id)
    )
    if note is None:
        raise NoteNotFoundError()
    note.title = _title(title)
    note.subject = _subject(subject)
    note.body = _body(body)
    note.updated_at = datetime.now(timezone.utc)
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(note)
    return note_dict(note)


def delete_note(session: Session, user_id: uuid.UUID, note_id: uuid.UUID) -> None:
    note = session.scalar(
        select(Note).where(Note.id == note_id, Note.user_id == user_id)
    )
    if note is None:
        raise NoteNotFoundError()
    session.delete(note)
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
