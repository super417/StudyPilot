"""Add optional literal quotation verification to mastery evidence."""
from alembic import op
import sqlalchemy as sa

revision = 'd4e5f6a7b8c1'
down_revision = 'c3a1b2c3d4e5'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('mastery_evidence', sa.Column('source_quote', sa.Text(), nullable=True))
    op.add_column('mastery_evidence', sa.Column('quote_check', sa.String(24), nullable=True))

def downgrade():
    with op.batch_alter_table('mastery_evidence') as batch:
        batch.drop_column('quote_check')
        batch.drop_column('source_quote')
