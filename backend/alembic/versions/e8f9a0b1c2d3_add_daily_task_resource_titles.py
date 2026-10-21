"""add optional chapter and section titles to daily tasks

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-10-21

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e8f9a0b1c2d3"
down_revision: Union[str, Sequence[str], None] = "d7e8f9a0b1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("daily_tasks", sa.Column("chapter_title", sa.Text(), nullable=True))
    op.add_column("daily_tasks", sa.Column("section_title", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("daily_tasks", "section_title")
    op.drop_column("daily_tasks", "chapter_title")
