"""Append missing call price snapshots without recreating billing tables.

Some local runtimes applied b1 before its price fields were added in development.
Both that shape and the later b1 shape are accepted. Unknown historical prices
remain NULL: today's rate cannot reconstruct the rate at an earlier call.

Revision ID: b2f9e8d7c6a5
Revises: b1c2d3e4f5a6
"""
from alembic import op
import sqlalchemy as sa

revision = "b2f9e8d7c6a5"
down_revision = "b1c2d3e4f5a6"
branch_labels = None
depends_on = None


def upgrade():
    columns = {item["name"] for item in sa.inspect(op.get_bind()).get_columns("billing_calls")}
    for name in ("input_price", "output_price"):
        if name not in columns:
            op.add_column("billing_calls", sa.Column(name, sa.String(64), nullable=True))


def downgrade():
    columns = {item["name"] for item in sa.inspect(op.get_bind()).get_columns("billing_calls")}
    # b1 is deliberately restored to its original no-price schema. Downgrade
    # removes only these fields, retaining call rows, balances, ledger and orders.
    with op.batch_alter_table("billing_calls") as batch:
        for name in ("input_price", "output_price"):
            if name in columns:
                batch.drop_column(name)
