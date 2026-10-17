"""add practice_questions.source_refs

Revision ID: b7c8d9e0f1a2
Revises: a6b7c8d9e0f1
Create Date: 2026-10-17 12:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7c8d9e0f1a2"
down_revision: Union[str, Sequence[str], None] = "a6b7c8d9e0f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("practice_questions") as batch:
        batch.add_column(sa.Column("source_refs", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("practice_questions") as batch:
        batch.drop_column("source_refs")
