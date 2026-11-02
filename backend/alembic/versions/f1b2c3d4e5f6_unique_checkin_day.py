"""Keep earliest check-in per user/day and enforce uniqueness.

Duplicate removal is irreversible; downgrade only removes the constraint.
"""
from alembic import op
import sqlalchemy as sa

revision = 'f1b2c3d4e5f6'
down_revision = 'e9a0b1c2d3e4'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text('''DELETE FROM check_ins WHERE id IN (
        SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY user_id, check_date ORDER BY created_at, id
            ) AS position FROM check_ins
        ) ranked WHERE position > 1
    )'''))
    with op.batch_alter_table('check_ins') as batch:
        batch.create_unique_constraint('uq_check_ins_user_date', ['user_id', 'check_date'])


def downgrade():
    with op.batch_alter_table('check_ins') as batch:
        batch.drop_constraint('uq_check_ins_user_date', type_='unique')
