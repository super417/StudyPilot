"""Separate expiring points from existing currency balances."""
from alembic import op
from app.models.credits import CreditLot, CreditCall, CreditLedger
revision = 'c3a1b2c3d4e5'
down_revision = 'b2f9e8d7c6a5'
branch_labels = None
depends_on = None


def upgrade():
    for table in (CreditLot.__table__, CreditCall.__table__, CreditLedger.__table__):
        table.create(op.get_bind())


def downgrade():
    for table in (CreditLedger.__table__, CreditCall.__table__, CreditLot.__table__):
        table.drop(op.get_bind())
