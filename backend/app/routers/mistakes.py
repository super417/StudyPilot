"""Mistake-book routes: list + badge, detail, review-status toggle (needs 6.2/6.3/6.5).

Plain REST endpoints scoped to the authenticated user. Every error collapses
to the shared ``{status, code, message}`` JSON shape used elsewhere.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import Mistake, User
from app.routers.dependencies import get_current_user
from app.services import mistake_service, ocr_service
from app.services.ai_proxy import (
    CredentialUnavailableError,
    NoVerifiedApiConfigError,
    build_client_error,
)
from app.services.mistake_service import (
    MistakeCreateValidationError,
    MistakeNotFoundError,
    MistakeReviewStatusValidationError,
)
from app.services.ocr_service import OcrFailedError, OcrImageError

router = APIRouter(prefix="/api/mistakes", tags=["mistakes"])


def _to_camel(field_name: str) -> str:
    head, *tail = field_name.split("_")
    return head + "".join(part.title() for part in tail)


def _json_error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "code": code, "message": message},
    )


class ReviewStatusPayload(BaseModel):
    """Body for the review-status toggle (camelCase from the frontend)."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    status: str = ""


class CreateMistakePayload(BaseModel):
    """Body for creating a mistake (camelCase from the frontend)."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    question: str = ""
    my_answer: str | None = None
    why_wrong: str | None = None
    correct_understanding: str | None = None
    subject: str | None = None


def _utc_iso(value: datetime | None) -> str | None:
    # SQLite returns naive datetimes; without an offset the browser would read UTC as local time.
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _list_item(mistake: Mistake, now: datetime) -> dict:
    return {
        "id": str(mistake.id),
        "question": mistake.question,
        "subject": mistake.subject,
        "reviewStatus": mistake.review_status,
        "nextReviewAt": _utc_iso(mistake.next_review_at),
        "due": mistake_service.is_due(mistake, now),
        "createdAt": mistake.created_at.isoformat(),
    }


def _detail(mistake: Mistake) -> dict:
    return {
        "id": str(mistake.id),
        "question": mistake.question,
        "myAnswer": mistake.my_answer,
        "whyWrong": mistake.why_wrong,
        "correctUnderstanding": mistake.correct_understanding,
        "subject": mistake.subject,
        "reviewStatus": mistake.review_status,
        "nextReviewAt": _utc_iso(mistake.next_review_at),
        "createdAt": mistake.created_at.isoformat(),
    }


@router.get("")
def list_mistakes_route(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    mistakes, pending_count = mistake_service.list_mistakes(session, user.id)
    now = datetime.now(timezone.utc)
    items = [_list_item(m, now) for m in mistakes]
    return JSONResponse(
        status_code=200,
        content={
            "status": "ok",
            "pendingCount": pending_count,
            "dueCount": sum(1 for item in items if item["due"]),
            "mistakes": items,
        },
    )


@router.post("", status_code=201)
def create_mistake_route(
    payload: CreateMistakePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    try:
        mistake = mistake_service.create_mistake(
            session,
            user.id,
            question=payload.question,
            my_answer=payload.my_answer,
            why_wrong=payload.why_wrong,
            correct_understanding=payload.correct_understanding,
            subject=payload.subject,
        )
    except MistakeCreateValidationError as error:
        return _json_error(400, error.code, str(error))
    return {"status": "ok", "mistake": _detail(mistake)}


@router.post("/ocr")
async def ocr_question_route(
    image: UploadFile = File(...),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    data = await image.read()
    try:
        mime = ocr_service.validate_image(image.content_type, data)
        text = await ocr_service.recognize_question(session, user.id, mime, data)
    except OcrImageError as error:
        return _json_error(400, error.code, str(error))
    except (NoVerifiedApiConfigError, CredentialUnavailableError) as error:
        body = build_client_error(error)
        return _json_error(400, body["code"], body["message"])
    except OcrFailedError as error:
        return _json_error(502, error.code, str(error))
    return JSONResponse(status_code=200, content={"status": "ok", "text": text})


@router.get("/{mistake_id}")
def get_mistake_route(
    mistake_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    try:
        parsed_id = uuid.UUID(mistake_id)
    except (ValueError, AttributeError, TypeError):
        return _json_error(404, MistakeNotFoundError.code, str(MistakeNotFoundError()))

    try:
        mistake = mistake_service.get_mistake(session, user.id, parsed_id)
    except MistakeNotFoundError as error:
        return _json_error(404, error.code, str(error))

    return JSONResponse(
        status_code=200,
        content={"status": "ok", "mistake": _detail(mistake)},
    )


@router.put("/{mistake_id}")
def update_mistake_route(
    mistake_id: str,
    payload: CreateMistakePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    try:
        parsed_id = uuid.UUID(mistake_id)
    except (ValueError, AttributeError, TypeError):
        return _json_error(404, MistakeNotFoundError.code, str(MistakeNotFoundError()))

    try:
        mistake = mistake_service.update_mistake(
            session,
            user.id,
            parsed_id,
            question=payload.question,
            my_answer=payload.my_answer,
            why_wrong=payload.why_wrong,
            correct_understanding=payload.correct_understanding,
            subject=payload.subject,
        )
    except MistakeCreateValidationError as error:
        return _json_error(400, error.code, str(error))
    except MistakeNotFoundError as error:
        return _json_error(404, error.code, str(error))

    return JSONResponse(
        status_code=200,
        content={"status": "ok", "mistake": _detail(mistake)},
    )


@router.patch("/{mistake_id}/review-status")
def set_review_status_route(
    mistake_id: str,
    payload: ReviewStatusPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    try:
        parsed_id = uuid.UUID(mistake_id)
    except (ValueError, AttributeError, TypeError):
        return _json_error(404, MistakeNotFoundError.code, str(MistakeNotFoundError()))

    try:
        mistake = mistake_service.set_review_status(
            session, user.id, parsed_id, payload.status
        )
    except MistakeReviewStatusValidationError as error:
        return _json_error(400, error.code, str(error))
    except MistakeNotFoundError as error:
        return _json_error(404, error.code, str(error))

    return JSONResponse(
        status_code=200,
        content={
            "status": "ok",
            "mistake": {
                "id": str(mistake.id),
                "reviewStatus": mistake.review_status,
                "nextReviewAt": _utc_iso(mistake.next_review_at),
            },
        },
    )


@router.delete("/{mistake_id}")
def delete_mistake_route(
    mistake_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    try:
        parsed_id = uuid.UUID(mistake_id)
    except (ValueError, AttributeError, TypeError):
        return _json_error(404, MistakeNotFoundError.code, str(MistakeNotFoundError()))

    try:
        mistake_service.delete_mistake(session, user.id, parsed_id)
    except MistakeNotFoundError as error:
        return _json_error(404, error.code, str(error))

    return JSONResponse(
        status_code=200,
        content={"status": "ok", "deletedId": mistake_id},
    )
