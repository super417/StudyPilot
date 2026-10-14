"""add mastery evidence ledger

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-10-14 21:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d2e3f4a5b6c7"
down_revision: Union[str, Sequence[str], None] = "c1d2e3f4a5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mastery_evidence",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("knowledge_point", sa.Uuid(), nullable=True),
        sa.Column("evidence_type", sa.String(length=16), nullable=False),
        sa.Column("result", sa.String(length=16), nullable=False),
        sa.Column("error_tag", sa.String(length=64), nullable=True),
        sa.Column("answer_text", sa.Text(), nullable=True),
        sa.Column("grade_reason", sa.Text(), nullable=True),
        sa.Column("source_ref", sa.String(length=255), nullable=True),
        sa.Column("question_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "evidence_type IN ('quiz', 'explanation', 'composite')",
            name="ck_mastery_evidence_evidence_type",
        ),
        sa.CheckConstraint(
            "result IN ('correct', 'partial', 'wrong')",
            name="ck_mastery_evidence_result",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["question_id"], ["practice_questions.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("mastery_evidence")
