"""Assistant conversation-history routes (need 8.7).

Plain REST endpoints scoped to the authenticated user: list / create / rename /
delete a conversation, plus read and replace its messages. Deleting here is a
hard delete — the frontend trash button must make the row disappear on both
sides, so there is no soft-delete flag to keep around.

Every error collapses to the shared ``{status, code, message}`` JSON shape.
"""

import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import ChatMessage, Conversation, User
from app.routers.dependencies import get_current_user
from app.services import conversation_service
from app.services.conversation_service import (
    ConversationNotFoundError,
    ConversationValidationError,
)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


def _to_camel(field_name: str) -> str:
    head, *tail = field_name.split("_")
    return head + "".join(part.title() for part in tail)


def _json_error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "code": code, "message": message},
    )


def _parse_id(raw: str) -> uuid.UUID | None:
    """Badly formed ids are reported as not-found, never as a 500."""
    try:
        return uuid.UUID(raw)
    except (ValueError, AttributeError, TypeError):
        return None


def _conversation_json(conversation: Conversation) -> dict:
    return {
        "id": str(conversation.id),
        "title": conversation.title,
        "contextType": conversation.context_type,
        "createdAt": conversation.created_at.isoformat(),
        "updatedAt": conversation.updated_at.isoformat(),
    }


def _message_json(message: ChatMessage) -> dict:
    return {
        "id": str(message.id),
        "role": message.role,
        "content": message.content,
    }


class ConversationCreatePayload(BaseModel):
    """Body for creating a conversation (camelCase from the frontend)."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    title: str | None = None
    context_type: str | None = None


class ConversationRenamePayload(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    title: str = ""


class MessagePayload(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    role: str = ""
    content: str = ""


class MessagesReplacePayload(BaseModel):
    """Full transcript from the client — replaces whatever is stored."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    messages: list[MessagePayload] = []


@router.get("")
def list_conversations_route(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    conversations = conversation_service.list_conversations(session, user.id)
    return JSONResponse(
        status_code=200,
        content={
            "status": "ok",
            "conversations": [_conversation_json(c) for c in conversations],
        },
    )


@router.post("", status_code=201)
def create_conversation_route(
    payload: ConversationCreatePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    try:
        conversation = conversation_service.create_conversation(
            session, user.id, payload.title, payload.context_type
        )
    except ConversationValidationError as error:
        return _json_error(422, error.code, str(error))

    return JSONResponse(
        status_code=201,
        content={"status": "ok", "conversation": _conversation_json(conversation)},
    )


@router.patch("/{conversation_id}")
def rename_conversation_route(
    conversation_id: str,
    payload: ConversationRenamePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    parsed_id = _parse_id(conversation_id)
    if parsed_id is None:
        return _json_error(404, ConversationNotFoundError.code, "会话不存在")

    try:
        conversation = conversation_service.rename_conversation(
            session, user.id, parsed_id, payload.title
        )
    except ConversationNotFoundError as error:
        return _json_error(404, error.code, str(error))

    return JSONResponse(
        status_code=200,
        content={"status": "ok", "conversation": _conversation_json(conversation)},
    )


@router.delete("/{conversation_id}")
def delete_conversation_route(
    conversation_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    parsed_id = _parse_id(conversation_id)
    if parsed_id is None:
        return _json_error(404, ConversationNotFoundError.code, "会话不存在")

    try:
        conversation_service.delete_conversation(session, user.id, parsed_id)
    except ConversationNotFoundError as error:
        return _json_error(404, error.code, str(error))

    return JSONResponse(
        status_code=200,
        content={"status": "ok", "deletedId": str(parsed_id)},
    )


@router.get("/{conversation_id}/messages")
def load_messages_route(
    conversation_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    parsed_id = _parse_id(conversation_id)
    if parsed_id is None:
        return _json_error(404, ConversationNotFoundError.code, "会话不存在")

    try:
        messages = conversation_service.load_messages(session, user.id, parsed_id)
    except ConversationNotFoundError as error:
        return _json_error(404, error.code, str(error))

    return JSONResponse(
        status_code=200,
        content={"status": "ok", "messages": [_message_json(m) for m in messages]},
    )


@router.put("/{conversation_id}/messages")
def replace_messages_route(
    conversation_id: str,
    payload: MessagesReplacePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    parsed_id = _parse_id(conversation_id)
    if parsed_id is None:
        return _json_error(404, ConversationNotFoundError.code, "会话不存在")

    try:
        messages = conversation_service.replace_messages(
            session,
            user.id,
            parsed_id,
            [(m.role, m.content) for m in payload.messages],
        )
    except ConversationValidationError as error:
        return _json_error(422, error.code, str(error))
    except ConversationNotFoundError as error:
        return _json_error(404, error.code, str(error))

    return JSONResponse(
        status_code=200,
        content={"status": "ok", "messages": [_message_json(m) for m in messages]},
    )
