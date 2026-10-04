"""Note routes."""

import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import User
from app.routers.dependencies import get_current_user
from app.services import note_service
from app.services.note_service import NoteNotFoundError, NoteValidationError

router = APIRouter(prefix="/api/notes", tags=["notes"])


def _to_camel(field_name: str) -> str:
    head, *tail = field_name.split("_")
    return head + "".join(part.title() for part in tail)


def _json_error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "code": code, "message": message},
    )


def _parse_id(note_id: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(note_id)
    except (ValueError, AttributeError, TypeError):
        return None


class NotePayload(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    title: str = ""
    subject: str | None = None
    body: str | None = None


@router.get("")
def list_notes_route(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    notes = note_service.list_notes(session, user.id)
    return JSONResponse(
        status_code=200,
        content={"status": "ok", "notes": notes},
    )


@router.post("", status_code=201)
def create_note_route(
    payload: NotePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    try:
        note = note_service.create_note(
            session,
            user.id,
            title=payload.title,
            subject=payload.subject,
            body=payload.body,
        )
    except NoteValidationError as error:
        return _json_error(400, error.code, str(error))
    return JSONResponse(status_code=201, content={"status": "ok", "note": note})


@router.put("/{note_id}")
def update_note_route(
    note_id: str,
    payload: NotePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    parsed = _parse_id(note_id)
    if parsed is None:
        return _json_error(404, NoteNotFoundError.code, str(NoteNotFoundError()))
    try:
        note = note_service.update_note(
            session,
            user.id,
            parsed,
            title=payload.title,
            subject=payload.subject,
            body=payload.body,
        )
    except NoteValidationError as error:
        return _json_error(400, error.code, str(error))
    except NoteNotFoundError as error:
        return _json_error(404, error.code, str(error))
    return JSONResponse(status_code=200, content={"status": "ok", "note": note})


@router.delete("/{note_id}")
def delete_note_route(
    note_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    parsed = _parse_id(note_id)
    if parsed is None:
        return _json_error(404, NoteNotFoundError.code, str(NoteNotFoundError()))
    try:
        note_service.delete_note(session, user.id, parsed)
    except NoteNotFoundError as error:
        return _json_error(404, error.code, str(error))
    return JSONResponse(
        status_code=200,
        content={"status": "ok", "deletedId": note_id},
    )
