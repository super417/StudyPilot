"""add plan direction_id

Revision ID: d7e8f9a0b1c2
Revises: c8d9e0f1a2b3
Create Date: 2026-10-21 17:45:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d7e8f9a0b1c2"
down_revision: Union[str, Sequence[str], None] = "c8d9e0f1a2b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable with no server default: existing plans keep NULL and keep the
    # direction-less behaviour. No backfill, no index (lookups go through
    # ``plans.id``).
    op.add_column("plans", sa.Column("direction_id", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("plans", "direction_id")
