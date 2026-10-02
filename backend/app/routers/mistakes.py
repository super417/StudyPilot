"""Mistake-book routes: list + badge, detail, review-status toggle (needs 6.2/6.3/6.5).

Plain REST endpoints scoped to the authenticated user. Every error collapses
to the shared ``{status, code, message}`` JSON shape used elsewhere.
"""

import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import Mistake, User
from app.routers.dependencies import get_current_user
from app.services import mistake_service
from app.services.mistake_service import (
    MistakeCreateValidationError,
    MistakeNotFoundError,
    MistakeReviewStatusValidationError,
)

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


def _list_item(mistake: Mistake) -> dict:
    return {
        "id": str(mistake.id),
        "question": mistake.question,
        "reviewStatus": mistake.review_status,
        "createdAt": mistake.created_at.isoformat(),
    }


def _detail(mistake: Mistake) -> dict:
    return {
        "id": str(mistake.id),
        "question": mistake.question,
        "myAnswer": mistake.my_answer,
        "whyWrong": mistake.why_wrong,
        "correctUnderstanding": mistake.correct_understanding,
        "reviewStatus": mistake.review_status,
        "nextReviewAt": (
            mistake.next_review_at.isoformat()
            if mistake.next_review_at is not None
            else None
        ),
        "createdAt": mistake.created_at.isoformat(),
    }


@router.get("")
def list_mistakes_route(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    mistakes, pending_count = mistake_service.list_mistakes(session, user.id)
    return JSONResponse(
        status_code=200,
        content={
            "status": "ok",
            "pendingCount": pending_count,
            "mistakes": [_list_item(m) for m in mistakes],
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
        )
    except MistakeCreateValidationError as error:
        return _json_error(400, error.code, str(error))
    return {"status": "ok", "mistake": _detail(mistake)}


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
            "mistake": {"id": str(mistake.id), "reviewStatus": mistake.review_status},
        },
    )
