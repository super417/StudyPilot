"""drop cached mastery columns from weekly reviews

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-10-14 22:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e3f4a5b6c7d8"
down_revision: Union[str, Sequence[str], None] = "d2e3f4a5b6c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("weekly_reviews") as batch:
        batch.drop_constraint(
            "ck_weekly_reviews_mastery_avg_range", type_="check"
        )
        batch.drop_column("mastery_avg")
        batch.drop_column("mastery_detail")


def downgrade() -> None:
    # The numbers that used to sit in these columns were frozen at the moment
    # the row was first created. They were already the wrong score, so they are
    # not copied back. The columns come back empty and nullable.
    with op.batch_alter_table("weekly_reviews") as batch:
        batch.add_column(sa.Column("mastery_avg", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("mastery_detail", sa.JSON(), nullable=True))
        batch.create_check_constraint(
            "ck_weekly_reviews_mastery_avg_range",
            "mastery_avg BETWEEN 0 AND 100",
        )
