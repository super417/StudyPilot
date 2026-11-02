"""Persist the tasks selected for a learning day."""
from alembic import op
import sqlalchemy as sa

revision = 'e9a0b1c2d3e4'
down_revision = 'd4e5f6a7b8c1'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'daily_selections',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('task_id', sa.Uuid(), sa.ForeignKey('daily_tasks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('study_date', sa.Date(), nullable=False),
        sa.Column('minutes', sa.Integer(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('learned', sa.Boolean(), nullable=False),
        sa.UniqueConstraint('user_id', 'study_date', 'task_id', name='uq_daily_selection_user_day_task'),
    )
    with op.batch_alter_table('practice_questions') as batch:
        batch.add_column(sa.Column('daily_selection_id', sa.Uuid(), nullable=True))
        batch.create_foreign_key('fk_practice_daily_selection', 'daily_selections', ['daily_selection_id'], ['id'], ondelete='SET NULL')


def downgrade():
    with op.batch_alter_table('practice_questions') as batch:
        batch.drop_constraint('fk_practice_daily_selection', type_='foreignkey')
        batch.drop_column('daily_selection_id')
    op.drop_table('daily_selections')
