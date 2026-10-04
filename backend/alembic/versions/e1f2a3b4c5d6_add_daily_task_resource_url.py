"""add daily task resource url

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-10-04 18:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, Sequence[str], None] = "d0e1f2a3b4c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("daily_tasks") as batch:
        batch.add_column(sa.Column("resource_url", sa.String(500), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("daily_tasks") as batch:
        batch.drop_column("resource_url")
