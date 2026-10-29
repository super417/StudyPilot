"""Platform balances, immutable ledger, payment orders and call reservations.

Revision ID: b1c2d3e4f5a6
Revises: a4b5c6d7e8f9
"""
from alembic import op
import sqlalchemy as sa

revision = "b1c2d3e4f5a6"
down_revision = "a4b5c6d7e8f9"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("billing_accounts",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("mode", sa.String(16), nullable=False), sa.Column("model_id", sa.String(128)),
        sa.Column("balance_micros", sa.BigInteger(), nullable=False), sa.Column("reserved_micros", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("balance_micros >= reserved_micros AND reserved_micros >= 0", name="ck_billing_account_funds"))
    op.create_table("payment_orders",
        sa.Column("id", sa.String(32), primary_key=True), sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("idempotency_key", sa.String(80), nullable=False), sa.Column("channel", sa.String(16), nullable=False),
        sa.Column("amount_fen", sa.Integer(), nullable=False), sa.Column("state", sa.String(16), nullable=False),
        sa.Column("transaction_id", sa.String(128), unique=True), sa.Column("payment_url", sa.Text()), sa.Column("code_url", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "idempotency_key", name="uq_payment_user_key"), sa.CheckConstraint("amount_fen > 0", name="ck_payment_positive"))
    op.create_index("ix_payment_orders_user_id", "payment_orders", ["user_id"])
    op.create_table("billing_ledger",
        sa.Column("id", sa.String(32), primary_key=True), sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reference", sa.String(80), unique=True, nullable=False), sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("amount_micros", sa.BigInteger(), nullable=False), sa.Column("description", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_billing_ledger_user_id", "billing_ledger", ["user_id"])
    op.create_table("billing_calls",
        sa.Column("id", sa.String(32), primary_key=True), sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("model_id", sa.String(128), nullable=False), sa.Column("state", sa.String(16), nullable=False),
        sa.Column("reserved_micros", sa.BigInteger(), nullable=False), sa.Column("charged_micros", sa.BigInteger(), nullable=False),
        sa.Column("input_tokens", sa.Integer()), sa.Column("output_tokens", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_billing_calls_user_id", "billing_calls", ["user_id"])


def downgrade():
    for table in ["billing_calls", "billing_ledger", "payment_orders", "billing_accounts"]:
        op.drop_table(table)
