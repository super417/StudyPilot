"""add reinforce_task_evidence link table

Revision ID: a6b7c8d9e0f1
Revises: f4a5b6c7d8e9
Create Date: 2026-10-16 15:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a6b7c8d9e0f1"
down_revision: Union[str, Sequence[str], None] = "f4a5b6c7d8e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "reinforce_task_evidence",
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("evidence_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["task_id"], ["daily_tasks.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["evidence_id"], ["mastery_evidence.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("task_id", "evidence_id"),
    )
    op.create_index(
        "ix_reinforce_task_evidence_evidence_id",
        "reinforce_task_evidence",
        ["evidence_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_reinforce_task_evidence_evidence_id",
        table_name="reinforce_task_evidence",
    )
    op.drop_table("reinforce_task_evidence")
