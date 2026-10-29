"""Money is stored in integer micro-yuan; no derived learning metrics live here."""
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from .entities import utc_now


class BillingAccount(Base):
    __tablename__ = "billing_accounts"
    __table_args__ = (CheckConstraint("balance_micros >= reserved_micros AND reserved_micros >= 0", name="ck_billing_account_funds"),)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    mode: Mapped[str] = mapped_column(String(16), default="byok", nullable=False)
    model_id: Mapped[str | None] = mapped_column(String(128))
    balance_micros: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    reserved_micros: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)


class PaymentOrder(Base):
    __tablename__ = "payment_orders"
    __table_args__ = (UniqueConstraint("user_id", "idempotency_key", name="uq_payment_user_key"), CheckConstraint("amount_fen > 0", name="ck_payment_positive"))
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    amount_fen: Mapped[int] = mapped_column(Integer, nullable=False)
    state: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    transaction_id: Mapped[str | None] = mapped_column(String(128), unique=True)
    payment_url: Mapped[str | None] = mapped_column(Text)
    code_url: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class BillingLedger(Base):
    __tablename__ = "billing_ledger"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    reference: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    amount_micros: Mapped[int] = mapped_column(BigInteger, nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class BillingCall(Base):
    __tablename__ = "billing_calls"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    model_id: Mapped[str] = mapped_column(String(128), nullable=False)
    # NULL only for historical calls made before price snapshots were available.
    input_price: Mapped[str | None] = mapped_column(String(64), nullable=True)
    output_price: Mapped[str | None] = mapped_column(String(64), nullable=True)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="reserved")
    reserved_micros: Mapped[int] = mapped_column(BigInteger, nullable=False)
    charged_micros: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
