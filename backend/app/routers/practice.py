"""Practice questions: list, generate, upload, mark, delete."""

from datetime import date
import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import User
from app.routers.dependencies import get_current_user
from app.services import practice_service
from app.services.api_config_service import NoVerifiedApiConfigError
from app.services.practice_service import (
    PracticeNotFoundError,
    PracticeValidationError,
    QuestionGenerator,
)

router = APIRouter(prefix="/api/practice", tags=["practice"])


def get_question_generator() -> QuestionGenerator | None:
    return None


def _to_camel(field_name: str) -> str:
    head, *tail = field_name.split("_")
    return head + "".join(part.title() for part in tail)


def _json_error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "code": code, "message": message},
    )


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


class PracticeCreatePayload(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    question: str = ""
    answer: str = ""
    explanation: str = ""
    subject: str = ""


class PracticeStatusPayload(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    status: str = ""
    my_answer: str | None = None


class PracticeGeneratePayload(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    date: str = ""


@router.get("")
def list_practice_route(
    date: str | None = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    day = _parse_date(date)
    if day is None:
        return _json_error(400, "VALIDATION", "日期参数不合法")
    body = practice_service.list_practice(session, user.id, day)
    return JSONResponse(status_code=200, content={"status": "ok", **body})


@router.post("/generate")
async def generate_practice_route(
    payload: PracticeGeneratePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
    generator: QuestionGenerator | None = Depends(get_question_generator),
) -> JSONResponse:
    day = _parse_date(payload.date)
    if day is None:
        return _json_error(400, "VALIDATION", "日期参数不合法")
    try:
        rows = await practice_service.generate_for_day(session, user.id, day, generator)
    except NoVerifiedApiConfigError as error:
        return _json_error(400, error.code, str(error))
    return JSONResponse(
        status_code=200,
        content={
            "status": "ok",
            "questions": [practice_service._question_json(row) for row in rows],
        },
    )


@router.post("")
def create_practice_route(
    payload: PracticeCreatePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    try:
        row = practice_service.create_uploaded(
            session,
            user.id,
            question=payload.question,
            answer=payload.answer,
            explanation=payload.explanation,
            subject=payload.subject,
        )
    except PracticeValidationError as error:
        return _json_error(400, error.code, str(error))
    return JSONResponse(
        status_code=201,
        content={"status": "ok", "question": practice_service._question_json(row)},
    )


@router.patch("/{question_id}/status")
def set_practice_status_route(
    question_id: str,
    payload: PracticeStatusPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    try:
        parsed = uuid.UUID(question_id)
    except (ValueError, AttributeError, TypeError):
        return _json_error(404, PracticeNotFoundError.code, str(PracticeNotFoundError()))
    try:
        row = practice_service.set_status(
            session, user.id, parsed, payload.status, payload.my_answer
        )
    except PracticeValidationError as error:
        return _json_error(400, error.code, str(error))
    except PracticeNotFoundError as error:
        return _json_error(404, error.code, str(error))
    return JSONResponse(
        status_code=200,
        content={"status": "ok", "question": practice_service._question_json(row)},
    )


@router.delete("/{question_id}")
def delete_practice_route(
    question_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    try:
        parsed = uuid.UUID(question_id)
    except (ValueError, AttributeError, TypeError):
        return _json_error(404, PracticeNotFoundError.code, str(PracticeNotFoundError()))
    try:
        practice_service.delete_question(session, user.id, parsed)
    except PracticeNotFoundError as error:
        return _json_error(404, error.code, str(error))
    return JSONResponse(status_code=200, content={"status": "ok", "deletedId": question_id})
