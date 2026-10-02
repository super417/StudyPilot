import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


def utc_now() -> datetime:
    """Return the current UTC timestamp for Python-side defaults."""
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "length(username) BETWEEN 3 AND 64", name="ck_users_username_length"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, nullable=False
    )
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    failed_login_count: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_active_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class ApiConfig(Base):
    __tablename__ = "api_configs"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    api_key_cipher: Mapped[str] = mapped_column(Text, nullable=False)
    model_type: Mapped[str] = mapped_column(String(64), nullable=False)
    base_url: Mapped[str] = mapped_column(String(512), nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )


class Plan(Base):
    __tablename__ = "plans"
    __table_args__ = (
        CheckConstraint(
            "total_phases BETWEEN 2 AND 12", name="ck_plans_total_phases_range"
        ),
        CheckConstraint("daily_minutes > 0", name="ck_plans_daily_minutes_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    goal_name: Mapped[str] = mapped_column(String(255), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    goal_date: Mapped[date] = mapped_column(Date, nullable=False)
    current_level: Mapped[str] = mapped_column(String(255), nullable=False)
    daily_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    total_phases: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class Phase(Base):
    __tablename__ = "phases"
    __table_args__ = (
        CheckConstraint(
            "progress_percent BETWEEN 0 AND 100",
            name="ck_phases_progress_percent_range",
        ),
        UniqueConstraint("plan_id", "phase_index", name="uq_phases_plan_phase_index"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, nullable=False
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("plans.id", ondelete="CASCADE"), nullable=False
    )
    phase_index: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    progress_percent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class DailyTask(Base):
    __tablename__ = "daily_tasks"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'done')", name="ck_daily_tasks_status_values"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, nullable=False
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("plans.id", ondelete="CASCADE"), nullable=False
    )
    phase_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("phases.id", ondelete="CASCADE"), nullable=False
    )
    task_date: Mapped[date] = mapped_column(Date, nullable=False)
    week_label: Mapped[str] = mapped_column(String(8), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)


class CheckIn(Base):
    __tablename__ = "check_ins"
    __table_args__ = (
        CheckConstraint(
            "duration_minutes > 0", name="ck_check_ins_duration_minutes_positive"
        ),
        CheckConstraint(
            "difficulty BETWEEN 1 AND 5", name="ck_check_ins_difficulty_range"
        ),
        CheckConstraint("energy BETWEEN 1 AND 5", name="ck_check_ins_energy_range"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    check_date: Mapped[date] = mapped_column(Date, nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    difficulty: Mapped[int] = mapped_column(Integer, nullable=False)
    energy: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class Mistake(Base):
    __tablename__ = "mistakes"
    __table_args__ = (
        CheckConstraint(
            "review_status IN ('pending', 'scheduled', 'done')",
            name="ck_mistakes_review_status_values",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    question: Mapped[str] = mapped_column(Text, nullable=False)
    my_answer: Mapped[str | None] = mapped_column(Text)
    why_wrong: Mapped[str | None] = mapped_column(Text)
    correct_understanding: Mapped[str | None] = mapped_column(Text)
    review_status: Mapped[str] = mapped_column(
        String(16), default="pending", nullable=False
    )
    next_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class WeeklyReview(Base):
    __tablename__ = "weekly_reviews"
    __table_args__ = (
        CheckConstraint(
            "total_minutes >= 0", name="ck_weekly_reviews_total_minutes_nonnegative"
        ),
        CheckConstraint(
            "streak_days >= 0", name="ck_weekly_reviews_streak_days_nonnegative"
        ),
        CheckConstraint(
            "completion_rate BETWEEN 0 AND 100",
            name="ck_weekly_reviews_completion_rate_range",
        ),
        CheckConstraint(
            "mastery_avg BETWEEN 0 AND 100",
            name="ck_weekly_reviews_mastery_avg_range",
        ),
        UniqueConstraint(
            "user_id", "week_start", "week_end", name="uq_weekly_reviews_user_week"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    week_end: Mapped[date] = mapped_column(Date, nullable=False)
    total_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    streak_days: Mapped[int] = mapped_column(Integer, nullable=False)
    completion_rate: Mapped[int] = mapped_column(Integer, nullable=False)
    mastery_avg: Mapped[int] = mapped_column(Integer, nullable=False)
    mastery_detail: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class Conversation(Base):
    """AI 助手的一条会话（需求 8.7：每次对话独立成一条记录）。

    消息挂在它下面（`chat_messages`），删会话即级联删其全部消息 —— 前端
    「点垃圾桶删除」要前后端同时消失，靠的就是这条 `ondelete="CASCADE"`。
    """

    __tablename__ = "conversations"
    __table_args__ = (
        CheckConstraint(
            "length(title) BETWEEN 1 AND 64", name="ck_conversations_title_length"
        ),
        CheckConstraint(
            "context_type IS NULL OR context_type IN ('mistake', 'plan', 'free')",
            name="ck_conversations_context_type_values",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(String(64), default="新对话", nullable=False)
    context_type: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )


class ChatMessage(Base):
    """会话内的一条消息。

    不落前端生成的字符串 id —— 前端 `PUT .../messages` 是**整体替换**语义
    （先删后插），id 由本表重新分配，前端只依赖顺序。
    """

    __tablename__ = "chat_messages"
    __table_args__ = (
        CheckConstraint(
            "role IN ('user', 'assistant')", name="ck_chat_messages_role_values"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, nullable=False
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("conversations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class UserDocument(Base):
    __tablename__ = "user_documents"
    __table_args__ = (
        UniqueConstraint(
            "doc_id", "chunk_index", name="uq_user_documents_doc_chunk"
        ),
        CheckConstraint(
            "chunk_index >= 0", name="ck_user_documents_chunk_index_nonnegative"
        ),
        CheckConstraint(
            "file_type IN ('pdf', 'docx', 'txt', 'md')",
            name="ck_user_documents_file_type_values",
        ),
        CheckConstraint(
            "length(content) <= 1000", name="ck_user_documents_content_length"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    doc_id: Mapped[str] = mapped_column(String(64), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[str] = mapped_column(String(16), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
