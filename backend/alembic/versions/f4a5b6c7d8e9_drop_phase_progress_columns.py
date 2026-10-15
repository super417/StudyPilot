"""drop stored phase progress columns

Revision ID: f4a5b6c7d8e9
Revises: e3f4a5b6c7d8
Create Date: 2026-10-15 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f4a5b6c7d8e9"
down_revision: Union[str, Sequence[str], None] = "e3f4a5b6c7d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("phases") as batch:
        batch.drop_constraint("ck_phases_progress_percent_range", type_="check")
        batch.drop_column("progress_percent")
        batch.drop_column("is_completed")


def downgrade() -> None:
    # The numbers in these columns were derived from DailyTask and frozen at
    # the last recompute. They were already stale whenever tasks changed
    # afterwards, so they are not copied back. The columns come back empty
    # and nullable.
    with op.batch_alter_table("phases") as batch:
        batch.add_column(sa.Column("progress_percent", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("is_completed", sa.Boolean(), nullable=True))
        batch.create_check_constraint(
            "ck_phases_progress_percent_range",
            "progress_percent BETWEEN 0 AND 100",
        )
