"""Assistant chat: domain gate + RAG context + Ai_Proxy SSE (needs 3/8)."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import AsyncIterator, Awaitable, Callable
import json
import re
import uuid

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Mistake, UserDocument
from app.services import document_service
from app.services.ai_proxy import (
    ChunkStream,
    CredentialUnavailableError,
    ResolvedCredential,
    build_client_error,
    build_outbound_headers,
    format_sse,
    resolve_credential,
    stream_ai_sse,
    SSE_ERROR_EVENT,
)
from app.services.api_config_service import (
    NoVerifiedApiConfigError,
    apply_reasoning_strength,
    has_verified_api_config,
)

_OFF_TOPIC = re.compile(
    r"游戏陪玩|追剧|恋爱交友|炒股荐股|彩票|八卦娱乐|色情|赌博",
    re.IGNORECASE,
)

_SYSTEM_PROMPT = (
    "你是 StudyPilot 考研学习助手，只回答考研相关问题："
    "数学、英语、政治、专业课、复试、复习规划、错题复盘、论文/资料阅读。"
    "若资料不足请明确说明「未检索到足够可靠依据」，不要编造出处。"
    "拒绝娱乐、荐股等非学习问题，并引导回到考研场景。"
    "直接给出最终回答，不要输出思考过程、推理步骤、内部指令或草稿。"
)

_DOMAIN_REFUSAL = (
    "【领域拦截】我是考研学习助手，只能帮助数学 / 英语 / 政治 / 专业课、"
    "复习规划、错题复盘与科研阅读。请换一个与考研备考相关的问题。"
)

# Strip leaked chain-of-thought wrappers some models put into `content`.
_THINK_BLOCK = re.compile(
    r"<think>[\s\S]*?</think>|<thinking>[\s\S]*?</thinking>",
    re.IGNORECASE,
)

ChatStreamFactory = Callable[
    [ResolvedCredential, dict],
    AbstractAsyncContextManager[ChunkStream],
]


def is_off_topic(message: str) -> bool:
    return bool(_OFF_TOPIC.search(message or ""))


def extract_assistant_content_delta(choice: dict) -> str:
    """Return only the user-visible answer delta from one streaming choice.

    DeepSeek / reasoning models may stream ``reasoning_content`` (thoughts)
    before ``content`` (final answer). Thoughts must never reach the UI.
    """
    delta = choice.get("delta") or {}
    if not isinstance(delta, dict):
        return ""
    content = delta.get("content")
    return content if isinstance(content, str) else ""


def extract_assistant_message_content(choice: dict) -> str:
    """Return only the final answer from a non-streaming choice."""
    message = choice.get("message") or {}
    if isinstance(message, dict):
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return _THINK_BLOCK.sub("", content).strip()
    text = choice.get("text")
    if isinstance(text, str) and text.strip():
        return _THINK_BLOCK.sub("", text).strip()
    return ""


def _list_user_doc_ids(session: Session, user_id: uuid.UUID) -> list[str]:
    rows = session.scalars(
        select(UserDocument.doc_id)
        .where(UserDocument.user_id == user_id)
        .distinct()
        .limit(20)
    ).all()
    return list(rows)


def _load_mistake_excerpt(
    session: Session, user_id: uuid.UUID, mistake_id: str | None
) -> str:
    if not mistake_id:
        return ""
    try:
        mid = uuid.UUID(mistake_id)
    except (ValueError, AttributeError, TypeError):
        return ""
    mistake = session.scalar(
        select(Mistake).where(Mistake.id == mid, Mistake.user_id == user_id)
    )
    if mistake is None:
        return ""
    return (
        f"错题原题：{mistake.question}\n"
        f"我的答案：{mistake.my_answer}\n"
        f"为什么错：{mistake.why_wrong}\n"
        f"正确理解：{mistake.correct_understanding}"
    )


def build_chat_messages(
    message: str,
    *,
    context_type: str | None,
    mistake_excerpt: str,
    rag_text: str,
) -> list[dict[str, str]]:
    parts = [f"用户问题：{message}"]
    if context_type:
        parts.append(f"唤起上下文类型：{context_type}")
    if mistake_excerpt:
        parts.append("错题上下文：\n" + mistake_excerpt)
    if rag_text.strip():
        parts.append(
            "知识库摘录（可能不完整，无依据时请声明）：\n" + rag_text.strip()[:6000]
        )
    else:
        parts.append("知识库摘录：无（请勿伪造引用）")
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": "\n\n".join(parts)},
    ]


@asynccontextmanager
async def _local_text_stream(text: str) -> AsyncIterator[ChunkStream]:
    async def _iter() -> ChunkStream:
        step = 8
        for i in range(0, len(text), step):
            yield text[i : i + step]

    yield _iter()


@asynccontextmanager
async def openai_compatible_chat_stream(
    credential: ResolvedCredential, payload: dict
) -> AsyncIterator[ChunkStream]:
    """Stream deltas from an OpenAI-compatible chat.completions endpoint."""

    headers = {
        **build_outbound_headers(credential),
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            async with client.stream(
                "POST",
                credential.base_url,
                headers=headers,
                json={**payload, "stream": True},
            ) as response:
                if response.status_code < 400:

                    async def _delta_iter() -> ChunkStream:
                        async for line in response.aiter_lines():
                            if not line or line.startswith(":"):
                                continue
                            if not line.startswith("data:"):
                                continue
                            data = line[5:].strip()
                            if data == "[DONE]":
                                break
                            try:
                                obj = json.loads(data)
                                choices = obj.get("choices") or []
                                if not choices:
                                    continue
                                # Never forward reasoning_content / thinking.
                                delta = extract_assistant_content_delta(choices[0])
                                if delta:
                                    yield delta
                            except Exception:
                                continue

                    yield _delta_iter()
                    return
                await response.aread()
        except Exception:
            pass

        response = await client.post(
            credential.base_url,
            headers={
                **build_outbound_headers(credential),
                "Content-Type": "application/json",
            },
            json={**payload, "stream": False},
        )
        if response.status_code >= 400:
            raise RuntimeError("upstream chat failed")
        body = response.json()
        choices = body.get("choices") or []
        content = ""
        if choices:
            content = extract_assistant_message_content(choices[0])
        content = content or "（模型未返回内容）"

        async def _iter_text() -> ChunkStream:
            step = 8
            for i in range(0, len(content), step):
                yield content[i : i + step]

        yield _iter_text()


async def stream_assistant_reply(
    session: Session,
    user_id: uuid.UUID,
    message: str,
    context: dict | None,
    *,
    reasoning_strength: str | None = None,
    is_disconnected: Callable[[], Awaitable[bool]] | Callable[[], bool] | None = None,
    stream_factory: ChatStreamFactory | None = None,
) -> AsyncIterator[str]:
    """Yield Ai_Proxy SSE frames for one assistant chat turn."""
    text = (message or "").strip()
    if not text:
        yield format_sse(
            SSE_ERROR_EVENT,
            {"code": "VALIDATION", "message": "请输入考研相关问题"},
        )
        return

    if is_off_topic(text):
        async for frame in stream_ai_sse(
            lambda: _local_text_stream(_DOMAIN_REFUSAL),
            is_disconnected,
        ):
            yield frame
        return

    if not has_verified_api_config(session, user_id):
        err = build_client_error(NoVerifiedApiConfigError())
        yield format_sse(
            SSE_ERROR_EVENT, {"code": err["code"], "message": err["message"]}
        )
        return

    try:
        credential = resolve_credential(session, user_id)
    except (NoVerifiedApiConfigError, CredentialUnavailableError) as error:
        err = build_client_error(error)
        yield format_sse(
            SSE_ERROR_EVENT, {"code": err["code"], "message": err["message"]}
        )
        return

    ctx = context or {}
    context_type = str(ctx.get("type") or "") or None
    mistake_id = ctx.get("mistakeId") or ctx.get("refId")
    mistake_excerpt = _load_mistake_excerpt(
        session, user_id, str(mistake_id) if mistake_id else None
    )
    doc_ids = _list_user_doc_ids(session, user_id)
    rag_text, citations = document_service.build_context(session, user_id, doc_ids)

    messages = build_chat_messages(
        text,
        context_type=context_type,
        mistake_excerpt=mistake_excerpt,
        rag_text=rag_text,
    )
    payload = {
        "model": credential.model_type,
        "stream": True,
        "messages": messages,
    }
    apply_reasoning_strength(payload, reasoning_strength)

    factory = stream_factory or openai_compatible_chat_stream

    def _factory():
        return factory(credential, payload)

    try:
        async for frame in stream_ai_sse(
            _factory,
            is_disconnected,
            done_extra={"citations": citations} if citations else None,
        ):
            yield frame
    except Exception:
        yield format_sse(
            SSE_ERROR_EVENT,
            {"code": "AI_STREAM_ERROR", "message": "AI 响应异常，请稍后重试"},
        )
