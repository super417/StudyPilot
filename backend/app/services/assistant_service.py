"""Assistant chat: domain gate + RAG context + Ai_Proxy SSE (needs 3/8)."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager, asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator, Awaitable, Callable
import json
import re
import uuid

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Mistake, Plan, UserDocument
from app.services import document_service
from app.services.video_draft_store import VideoDraft, video_draft_store
from app.services.video_link import (
    extract_url,
    fetch_link,
    format_material,
    latest_url,
    merge_into_daily_plan,
    parse_start_date,
    start_question,
    study_brief,
    suggest_start,
    wants_to_adopt,
)
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
    "学习建议可以正常给：复习路径、教材与课程名、公开学习平台的选择思路，"
    "不要因为「没有上传资料」就拒绝回答。"
    "引用纪律必须遵守：知识库摘录里没有的内容，不要说成「资料里写着」，"
    "也不要给出页码、题号这类精确出处。"
    "推荐具体平台时给平台名或平台首页（如 B 站、中国大学 MOOC、学堂在线、考研帮），"
    "不要编造具体视频或课程页的链接地址。"
    "确实没有可靠依据时直接说明「这块我没有可靠依据」，不要编造。"
    "拒绝娱乐、荐股等非学习问题，并引导回到考研场景。"
    "直接给出最终回答，不要输出思考过程、推理步骤、内部指令或草稿。"
    "用普通中文句子写，不要用 Markdown：不要写 **、#、行首的 - 列表，也不要写 --- 分隔线。"
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
    study_text: str = "",
    video_text: str = "",
) -> list[dict[str, str]]:
    parts = [f"用户问题：{message}"]
    if context_type:
        parts.append(f"唤起上下文类型：{context_type}")
    if mistake_excerpt:
        parts.append("错题上下文：\n" + mistake_excerpt)
    if study_text:
        parts.append(study_text)
    if video_text:
        parts.append(
            "链接内容（已经打开用户发来的链接，按他这句话的需求来用，不要说没打开）：\n"
            + video_text
            + "\n对照用户的目标、当前水平、每天时长和当前阶段给建议。"
            "建议适合现在学，就说明原因，并问一句要不要按这个链接里的内容来学。"
            "用户还没同意时，不要说规划已经改了。"
            "不适合就说明差在哪里，不要问要不要排进规划。"
            "只根据上面读到的内容说，不要编造页面里没有的章节。"
        )
    elif extract_url(message):
        parts.append("链接内容：这个链接没有打开。不要编造页面里的标题和章节，请用户换一个打得开的链接或补充标题。")
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
    video_fetcher=None,
    now: datetime | None = None,
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

    fetcher = video_fetcher or fetch_link
    current = now or datetime.now(timezone(timedelta(hours=8)))
    linked = extract_url(text)
    draft = video_draft_store.get(user_id, current)
    if draft is not None and not linked:
        chosen = parse_start_date(text, current.date())
        if chosen is None and wants_to_adopt(text):
            chosen = draft.suggested_start
        if chosen is not None:
            reply = merge_into_daily_plan(session, user_id, draft.material, chosen)
            video_draft_store.clear(user_id)
            async for frame in stream_ai_sse(
                lambda: _local_text_stream(reply),
                is_disconnected,
            ):
                yield frame
            return

    fetched = False
    material = None
    if linked or wants_to_adopt(text):
        url = linked or latest_url(session, user_id)
        if url:
            fetched = True
            material = await fetcher(url)
            if material:
                plan = session.scalar(
                    select(Plan)
                    .where(Plan.user_id == user_id)
                    .order_by(Plan.created_at.desc(), Plan.id.desc())
                )
                if plan is None:
                    reply = "还没有每日规划。先生成规划，再说按这个来学，我才能把链接里的内容排进每一天。"
                else:
                    video_draft_store.put(
                        VideoDraft(
                            user_id=user_id,
                            material=material,
                            url=url,
                            suggested_start=suggest_start(current),
                            created_at=current,
                        )
                    )
                    reply = start_question(material, plan.daily_minutes, current)
                async for frame in stream_ai_sse(
                    lambda: _local_text_stream(reply),
                    is_disconnected,
                ):
                    yield frame
                return
            if wants_to_adopt(text):
                async for frame in stream_ai_sse(
                    lambda: _local_text_stream(
                        "这个链接没有打开，没读到里面的内容。换一个打得开的链接，或把标题和章节发我。"
                    ),
                    is_disconnected,
                ):
                    yield frame
                return

    video_text = ""
    if linked:
        if not fetched:
            material = await fetcher(linked)
        video_text = format_material(material) if material else ""

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
        study_text=study_brief(session, user_id) if linked else "",
        video_text=video_text,
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
