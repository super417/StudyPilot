"""Assistant conversation history: list, create, rename, delete, messages.

需求 8.7 —— 每次对话独立成一条记录，每条会话各自保留最近 100 条消息。

前端「聊天记录」抽屉的删除按钮要求**前后端同时消失**，所以删除在这里是
真删：先删该会话的全部消息，再删会话行。不依赖数据库的 ``ON DELETE CASCADE``
—— SQLite 默认不打开 ``PRAGMA foreign_keys``，靠级联会留下孤儿消息。

归属一律经 ``user_id`` 过滤：别人的会话 id 与不存在的 id 返回同一个
``CONVERSATION_NOT_FOUND``，不泄露 id 是否存在。
"""

import uuid
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.entities import ChatMessage, Conversation, utc_now

VALID_CONTEXT_TYPES = ("mistake", "plan", "free")

#: 需求 8.7 —— 每个会话各自保留最近 100 条，不是全局共用 100 条。
MAX_MESSAGES_PER_CONVERSATION = 100

#: 单条消息正文上限。超出直接截断，不报错 —— 演示时模型偶尔长篇输出，
#: 让整次保存失败比截断更糟。
MAX_CONTENT_LENGTH = 20_000

#: 标题上限，与 ``ck_conversations_title_length`` 对齐（超出截断）。
MAX_TITLE_LENGTH = 64

DEFAULT_TITLE = "新对话"


class ConversationNotFoundError(ValueError):
    """Raised when a conversation id does not resolve to one the user owns."""

    code = "CONVERSATION_NOT_FOUND"

    def __init__(self, message: str = "会话不存在") -> None:
        super().__init__(message)


class ConversationValidationError(ValueError):
    """Raised when a payload field is not acceptable."""

    code = "VALIDATION"

    def __init__(self, message: str = "参数不合法") -> None:
        super().__init__(message)


def _clean_title(title: str | None) -> str:
    text = (title or "").strip() or DEFAULT_TITLE
    return text[:MAX_TITLE_LENGTH]


def list_conversations(session: Session, user_id: uuid.UUID) -> list[Conversation]:
    """Return the user's conversations, most recently active first."""
    return list(
        session.scalars(
            select(Conversation)
            .where(Conversation.user_id == user_id)
            .order_by(Conversation.updated_at.desc(), Conversation.id)
        )
    )


def create_conversation(
    session: Session,
    user_id: uuid.UUID,
    title: str | None = None,
    context_type: str | None = None,
) -> Conversation:
    """Create an empty conversation owned by ``user_id``."""
    if context_type is not None and context_type not in VALID_CONTEXT_TYPES:
        raise ConversationValidationError("会话上下文类型不合法")

    conversation = Conversation(
        user_id=user_id,
        title=_clean_title(title),
        context_type=context_type,
    )
    session.add(conversation)
    session.commit()
    session.refresh(conversation)
    return conversation


def get_conversation(
    session: Session, user_id: uuid.UUID, conversation_id: uuid.UUID
) -> Conversation:
    """Fetch one conversation the user owns, or raise ``CONVERSATION_NOT_FOUND``."""
    conversation = session.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id, Conversation.user_id == user_id
        )
    )
    if conversation is None:
        raise ConversationNotFoundError()
    return conversation


def rename_conversation(
    session: Session,
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    title: str,
) -> Conversation:
    """Rename a conversation; a blank title keeps the previous one."""
    conversation = get_conversation(session, user_id, conversation_id)
    if title.strip():
        conversation.title = _clean_title(title)
    session.commit()
    session.refresh(conversation)
    return conversation


def delete_conversation(
    session: Session, user_id: uuid.UUID, conversation_id: uuid.UUID
) -> None:
    """Hard-delete a conversation **and** all of its messages.

    Messages go first so the delete works regardless of whether the backend
    enforces foreign keys (SQLite ships with ``PRAGMA foreign_keys=OFF``).
    """
    conversation = get_conversation(session, user_id, conversation_id)
    session.execute(
        delete(ChatMessage).where(ChatMessage.conversation_id == conversation.id)
    )
    session.delete(conversation)
    session.commit()


def load_messages(
    session: Session, user_id: uuid.UUID, conversation_id: uuid.UUID
) -> list[ChatMessage]:
    """Return one conversation's messages in chronological order."""
    get_conversation(session, user_id, conversation_id)
    return list(
        session.scalars(
            select(ChatMessage)
            .where(ChatMessage.conversation_id == conversation_id)
            .order_by(ChatMessage.created_at, ChatMessage.id)
        )
    )


def replace_messages(
    session: Session,
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    messages: list[tuple],
) -> list[ChatMessage]:
    """Replace a conversation's whole message list (frontend save semantics).

    The client owns the transcript and re-sends it in full after each reply
    finishes streaming, so this is delete-then-insert rather than a diff.
    Only the newest ``MAX_MESSAGES_PER_CONVERSATION`` entries are kept.
    """
    conversation = get_conversation(session, user_id, conversation_id)

    # 先校验再落库：中途抛错时不该留下「删干净了但没插回去」的半截状态。
    kept = messages[-MAX_MESSAGES_PER_CONVERSATION:]
    for item in kept:
        if item[0] not in ("user", "assistant"):
            raise ConversationValidationError("消息角色不合法")

    session.execute(
        delete(ChatMessage).where(ChatMessage.conversation_id == conversation.id)
    )
    rows: list[ChatMessage] = []
    for item in kept:
        role, content, created_at = item[0], item[1], item[2]
        citations = item[3] if len(item) > 3 else None
        row = ChatMessage(
            conversation_id=conversation.id,
            role=role,
            content=content[:MAX_CONTENT_LENGTH],
            citations=citations,
        )
        if created_at is not None:
            row.created_at = created_at
        rows.append(row)
    session.add_all(rows)

    # 会话列表按「最近活跃」排序，所以每次写入都要顶一下时间戳。
    conversation.updated_at = utc_now()
    session.commit()
    session.refresh(conversation)
    return load_messages(session, user_id, conversation_id)
