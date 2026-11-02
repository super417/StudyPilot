"""Compatibility revision; task-based check-ins supersede daily deduplication.
Do not delete legitimate same-day history when upgrading through this revision.
"""
revision = 'f1b2c3d4e5f6'
down_revision = 'e9a0b1c2d3e4'
branch_labels = None
depends_on = None

def upgrade():
    pass

def downgrade():
    pass
