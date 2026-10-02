"""Assistant chat SSE route: POST /api/assistant/chat (needs 3, 8)."""

from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import User
from app.routers.dependencies import get_current_user
from app.services import assistant_service
from app.services.assistant_service import ChatStreamFactory

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

SSE_MEDIA_TYPE = "text/event-stream"


def _to_camel(field_name: str) -> str:
    head, *tail = field_name.split("_")
    return head + "".join(part.title() for part in tail)


class ChatContext(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    type: str | None = None
    mistake_id: str | None = None
    ref_id: str | None = None
    hint: str | None = None


class ChatPayload(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    message: str = ""
    context: ChatContext | None = None
    reasoning_strength: str | None = None


def get_assistant_stream_factory() -> ChatStreamFactory | None:
    """Injectable stream factory for tests; ``None`` = OpenAI-compatible default."""
    return None


@router.post("/chat")
async def assistant_chat_route(
    payload: ChatPayload,
    request: Request,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
    stream_factory: ChatStreamFactory | None = Depends(get_assistant_stream_factory),
) -> StreamingResponse:
    context: dict | None = None
    if payload.context is not None:
        context = {
            "type": payload.context.type,
            "mistakeId": payload.context.mistake_id,
            "refId": payload.context.ref_id,
            "hint": payload.context.hint,
        }

    async def stream() -> AsyncIterator[str]:
        async for frame in assistant_service.stream_assistant_reply(
            session,
            user.id,
            payload.message,
            context,
            reasoning_strength=payload.reasoning_strength,
            is_disconnected=request.is_disconnected,
            stream_factory=stream_factory,
        ):
            yield frame

    return StreamingResponse(stream(), media_type=SSE_MEDIA_TYPE)
