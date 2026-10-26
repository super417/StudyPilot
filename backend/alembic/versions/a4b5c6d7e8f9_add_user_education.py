"""add optional school and major to user profile

Revision ID: a4b5c6d7e8f9
Revises: f7a8b9c0d1e2
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a4b5c6d7e8f9"
down_revision: Union[str, Sequence[str], None] = "f7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("school", sa.String(length=128), nullable=False, server_default=""))
    op.add_column("users", sa.Column("major", sa.String(length=128), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("users", "major")
    op.drop_column("users", "school")
