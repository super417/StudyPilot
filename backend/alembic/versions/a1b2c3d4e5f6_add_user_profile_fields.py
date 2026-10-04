"""add user profile fields

Revision ID: a1b2c3d4e5f6
Revises: c4f1a7b93e20
Create Date: 2026-10-02 22:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "c4f1a7b93e20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("nickname", sa.String(length=64), nullable=False, server_default=""),
    )
    op.add_column(
        "users",
        sa.Column("direction", sa.String(length=128), nullable=False, server_default=""),
    )
    op.add_column(
        "users",
        sa.Column(
            "target_school", sa.String(length=128), nullable=False, server_default=""
        ),
    )
    op.add_column(
        "users",
        sa.Column("bio", sa.String(length=280), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("users", "bio")
    op.drop_column("users", "target_school")
    op.drop_column("users", "direction")
    op.drop_column("users", "nickname")
