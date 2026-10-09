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
    nickname: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    direction: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    target_school: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    bio: Mapped[str] = mapped_column(String(280), default="", nullable=False)
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


class PlanRevision(Base):
    """Read-only snapshot taken before a plan's phases are rebuilt."""

    __tablename__ = "plan_revisions"
    __table_args__ = (
        UniqueConstraint(
            "plan_id", "revision_no", name="uq_plan_revisions_plan_revision_no"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, nullable=False
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("plans.id", ondelete="CASCADE"), nullable=False
    )
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class PlanAdjustment(Base):
    """Persisted plan-edit preview waiting for confirm / reject / undo."""

    __tablename__ = "plan_adjustments"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'confirmed', 'rejected', 'conflict', 'undone')",
            name="ck_plan_adjustments_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("plans.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    instruction: Mapped[str] = mapped_column(Text, nullable=False, default="")
    basis_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    proposal: Mapped[dict] = mapped_column(JSON, nullable=False)
    diff: Mapped[dict] = mapped_column(JSON, nullable=False)
    validation: Mapped[dict] = mapped_column(JSON, nullable=False)
    steps: Mapped[list] = mapped_column(JSON, nullable=False)
    decision_summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    evidence_refs: Mapped[list] = mapped_column(JSON, nullable=False)
    applied_record: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
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
            "status IN ('pending', 'done', 'carried')",
            name="ck_daily_tasks_status_values",
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
    carried_from_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("daily_tasks.id", ondelete="SET NULL"), nullable=True
    )
    # Optional public study link for this task (公开平台首页/课程页). Only
    # host-whitelisted addresses are ever written here — see
    # ``services/resource_links.py``. ``NULL`` means the task has no resource.
    resource_url: Mapped[str | None] = mapped_column(String(500), nullable=True)


class PracticeQuestion(Base):
    __tablename__ = "practice_questions"
    __table_args__ = (
        CheckConstraint(
            "source IN ('generated', 'uploaded')",
            name="ck_practice_questions_source",
        ),
        CheckConstraint(
            "status IN ('pending', 'correct', 'wrong')",
            name="ck_practice_questions_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    subject: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, default="", nullable=False)
    explanation: Mapped[str] = mapped_column(Text, default="", nullable=False)
    source_task_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("daily_tasks.id", ondelete="SET NULL"), nullable=True
    )
    source_mistake_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("mistakes.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


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
        CheckConstraint(
            "review_step >= 0", name="ck_mistakes_review_step_nonnegative"
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
    subject: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    review_status: Mapped[str] = mapped_column(
        String(16), default="pending", nullable=False
    )
    next_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_step: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
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
    citations: Mapped[str | None] = mapped_column(Text)
    # Send order inside one conversation. Reload sorts by this, never by the clock.
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class Note(Base):
    __tablename__ = "notes"
    __table_args__ = (
        CheckConstraint(
            "length(title) BETWEEN 1 AND 120", name="ck_notes_title_length"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    subject: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class Course(Base):
    __tablename__ = "courses"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'paused')", name="ck_courses_status_values"
        ),
        CheckConstraint(
            "length(name) BETWEEN 1 AND 64", name="ck_courses_name_length"
        ),
        UniqueConstraint("user_id", "name", name="uq_courses_user_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class CourseChapter(Base):
    __tablename__ = "course_chapters"
    __table_args__ = (
        CheckConstraint(
            "length(title) BETWEEN 1 AND 80", name="ck_course_chapters_title_length"
        ),
        CheckConstraint(
            "length(url) BETWEEN 8 AND 500", name="ck_course_chapters_url_length"
        ),
        CheckConstraint("position >= 0", name="ck_course_chapters_position_nonnegative"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, nullable=False
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(80), nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
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
