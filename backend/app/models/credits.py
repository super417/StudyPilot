import uuid
from datetime import datetime
from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column
from .base import Base
from .entities import utc_now


class CreditLot(Base):
    __tablename__ = 'credit_lots'
    __table_args__ = (CheckConstraint('remaining >= reserved AND reserved >= 0', name='ck_credit_lot_funds'),)
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey('users.id', ondelete='CASCADE'), index=True)
    kind: Mapped[str] = mapped_column(String(24))
    granted: Mapped[int] = mapped_column(BigInteger)
    remaining: Mapped[int] = mapped_column(BigInteger)
    reserved: Mapped[int] = mapped_column(BigInteger, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class CreditCall(Base):
    __tablename__ = 'credit_calls'
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey('users.id', ondelete='CASCADE'), index=True)
    state: Mapped[str] = mapped_column(String(16), default='reserved')
    allocations: Mapped[str] = mapped_column(Text)
    input_price: Mapped[str] = mapped_column(String(64))
    output_price: Mapped[str] = mapped_column(String(64))
    input_tokens: Mapped[int | None] = mapped_column(BigInteger)
    output_tokens: Mapped[int | None] = mapped_column(BigInteger)
    charged: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class CreditLedger(Base):
    __tablename__ = 'credit_ledger'
    id: Mapped[str] = mapped_column(String(110), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey('users.id', ondelete='CASCADE'), index=True)
    kind: Mapped[str] = mapped_column(String(24))
    amount: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
