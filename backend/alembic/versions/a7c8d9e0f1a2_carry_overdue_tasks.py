"""carry overdue daily tasks

Revision ID: a7c8d9e0f1a2
Revises: f6a7b8c9d0e1
Create Date: 2026-10-04 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7c8d9e0f1a2"
down_revision: Union[str, Sequence[str], None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("daily_tasks") as batch:
        batch.drop_constraint("ck_daily_tasks_status_values", type_="check")
        batch.create_check_constraint(
            "ck_daily_tasks_status_values",
            "status IN ('pending', 'done', 'carried')",
        )
        batch.add_column(sa.Column("carried_from_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key(
            "fk_daily_tasks_carried_from_id",
            "daily_tasks",
            ["carried_from_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("daily_tasks") as batch:
        batch.drop_constraint("fk_daily_tasks_carried_from_id", type_="foreignkey")
        batch.drop_column("carried_from_id")
        batch.drop_constraint("ck_daily_tasks_status_values", type_="check")
        batch.create_check_constraint(
            "ck_daily_tasks_status_values",
            "status IN ('pending', 'done')",
        )
