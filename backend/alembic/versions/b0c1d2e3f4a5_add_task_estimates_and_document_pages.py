"""add task estimates and document page numbers

Revision ID: b0c1d2e3f4a5
Revises: a9b0c1d2e3f4
Create Date: 2026-10-10 13:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b0c1d2e3f4a5"
down_revision: Union[str, Sequence[str], None] = "a9b0c1d2e3f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("daily_tasks") as batch:
        batch.add_column(sa.Column("estimated_minutes", sa.Integer(), nullable=True))
        batch.create_check_constraint(
            "ck_daily_tasks_estimated_minutes_positive",
            "estimated_minutes IS NULL OR estimated_minutes > 0",
        )
    op.add_column(
        "user_documents",
        sa.Column("page_start", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user_documents", "page_start")
    with op.batch_alter_table("daily_tasks") as batch:
        batch.drop_constraint(
            "ck_daily_tasks_estimated_minutes_positive",
            type_="check",
        )
        batch.drop_column("estimated_minutes")
