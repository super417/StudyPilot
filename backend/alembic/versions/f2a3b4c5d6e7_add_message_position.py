"""chat messages keep send order in position, not the clock

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-10-04 21:12:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, Sequence[str], None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT rowid, conversation_id FROM chat_messages "
            "ORDER BY conversation_id, rowid"
        )
    ).fetchall()
    last_conversation = None
    index = 0
    for rowid, conversation_id in rows:
        if conversation_id != last_conversation:
            last_conversation = conversation_id
            index = 0
        connection.execute(
            sa.text("UPDATE chat_messages SET position = :position WHERE rowid = :rowid"),
            {"position": index, "rowid": rowid},
        )
        index += 1


def downgrade() -> None:
    op.drop_column("chat_messages", "position")
