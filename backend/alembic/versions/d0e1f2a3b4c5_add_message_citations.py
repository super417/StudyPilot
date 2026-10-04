"""add chat message citations

Revision ID: d0e1f2a3b4c5
Revises: c9e0f1a2b3c4
Create Date: 2026-10-04 18:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, Sequence[str], None] = "c9e0f1a2b3c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("chat_messages", sa.Column("citations", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_messages", "citations")
