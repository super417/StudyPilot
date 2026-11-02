"""Task-linked check-ins; historical rows remain unlinked and untouched."""
from alembic import op
import sqlalchemy as sa
revision = 'a2b3c4d5e6f7'
down_revision = 'f1b2c3d4e5f6'
branch_labels = None
depends_on = None

def upgrade():
    names = {c['name'] for c in sa.inspect(op.get_bind()).get_unique_constraints('check_ins')}
    with op.batch_alter_table('check_ins') as batch:
        if 'uq_check_ins_user_date' in names:
            batch.drop_constraint('uq_check_ins_user_date', type_='unique')
        batch.add_column(sa.Column('task_id', sa.Uuid(), nullable=True))
        batch.create_foreign_key('fk_check_ins_task_id', 'daily_tasks', ['task_id'], ['id'], ondelete='RESTRICT')
        batch.create_unique_constraint('uq_check_ins_user_task', ['user_id', 'task_id'])

def downgrade():
    # f1 is now a compatibility revision without daily uniqueness.
    with op.batch_alter_table('check_ins') as batch:
        batch.drop_constraint('uq_check_ins_user_task', type_='unique')
        batch.drop_constraint('fk_check_ins_task_id', type_='foreignkey')
        batch.drop_column('task_id')
