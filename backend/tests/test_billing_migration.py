"""Run Alembic only on an explicitly isolated temporary SQLite database."""
import os
from pathlib import Path
import subprocess
import sys
import uuid
from datetime import datetime, timezone

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from app.models.entities import User
from app.models.billing import BillingAccount, BillingLedger, PaymentOrder
from app.routers.billing import read_account


HEAD = "c3a1b2c3d4e5"


def migration_runner(tmp_path, name):
    database = tmp_path / name
    backend = Path(__file__).resolve().parents[1]
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{database.as_posix()}", "DB_PASSWORD": "fixture-only", "AES_KEY": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}
    def migrate(*arguments):
        result = subprocess.run([sys.executable, "-m", "alembic", *arguments], cwd=backend, env=env, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
    return env["DATABASE_URL"], migrate


def seed_early_b1(database_url):
    engine = create_engine(database_url)
    user_id = uuid.uuid4()
    with Session(engine) as session:
        session.add(User(id=user_id, username="migration-fixture", password_hash="fixture-hash"))
        session.flush()
        session.add(BillingAccount(user_id=user_id, mode="byok", balance_micros=999995, reserved_micros=0))
        session.add(PaymentOrder(id="fixture-order", user_id=user_id, idempotency_key="fixture-key", channel="alipay", amount_fen=100, state="paid", transaction_id="alipay:fixture-transaction"))
        session.add(BillingLedger(user_id=user_id, reference="order:fixture-order", kind="recharge", amount_micros=1000000, description="fixture recharge"))
        session.add(BillingLedger(user_id=user_id, reference="call:fixture-call", kind="ai_charge", amount_micros=-5, description="fixture call"))
        session.commit()
    with engine.begin() as connection:
        # Raw historical schema deliberately lacks the later ORM price columns.
        connection.execute(text("INSERT INTO billing_calls (id,user_id,model_id,state,reserved_micros,charged_micros,input_tokens,output_tokens,created_at,expires_at) VALUES (:id,:uid,:model,'settled',375,5,10,2,:now,:now)"), {"id": "fixture-call", "uid": user_id.hex, "model": "fixture-model", "now": datetime.now(timezone.utc).isoformat()})
    engine.dispose()
    return user_id


def preserved_financial_rows(engine):
    with engine.connect() as connection:
        assert connection.execute(text("SELECT balance_micros,reserved_micros FROM billing_accounts")).one() == (999995, 0)
        assert connection.execute(text("SELECT amount_fen,state,transaction_id FROM payment_orders")).one() == (100, "paid", "alipay:fixture-transaction")
        assert connection.execute(text("SELECT COUNT(*),SUM(amount_micros) FROM billing_ledger")).one() == (2, 999995)
        assert connection.execute(text("SELECT id,state,charged_micros FROM billing_calls")).one() == ("fixture-call", "settled", 5)


def test_upgrade_downgrade_upgrade_on_temporary_sqlite(tmp_path):
    database_url, migrate = migration_runner(tmp_path, "billing-migration.sqlite")
    migrate("upgrade", "head")
    engine = create_engine(database_url)
    assert {"billing_accounts", "billing_calls", "payment_orders", "billing_ledger"} <= set(inspect(engine).get_table_names())
    with engine.begin() as connection:
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar() == HEAD
    engine.dispose()
    migrate("downgrade", "a4b5c6d7e8f9")
    engine = create_engine(database_url)
    assert "billing_accounts" not in inspect(engine).get_table_names()
    assert "users" in inspect(engine).get_table_names()
    engine.dispose()
    migrate("upgrade", "head")
    engine = create_engine(database_url)
    assert "billing_accounts" in inspect(engine).get_table_names()
    engine.dispose()


def test_early_b1_missing_price_columns_upgrade_preserves_money_and_calls(tmp_path):
    database_url, migrate = migration_runner(tmp_path, "early-b1.sqlite")
    migrate("upgrade", "b1c2d3e4f5a6")
    user_id = seed_early_b1(database_url)
    engine = create_engine(database_url)
    assert "input_price" not in {column["name"] for column in inspect(engine).get_columns("billing_calls")}
    preserved_financial_rows(engine)
    engine.dispose()

    migrate("upgrade", "head")
    engine = create_engine(database_url)
    preserved_financial_rows(engine)
    with engine.connect() as connection:
        assert connection.execute(text("SELECT input_price,output_price FROM billing_calls")).one() == (None, None)
    with Session(engine) as session:
        # This exact account read previously raised no-such-column on early b1.
        result = read_account(user=session.get(User, user_id), session=session)
        assert result["balanceMicros"] == 999995 and len(result["ledger"]) == 2
    engine.dispose()

    migrate("downgrade", "b1c2d3e4f5a6")
    engine = create_engine(database_url)
    preserved_financial_rows(engine)
    assert "input_price" not in {column["name"] for column in inspect(engine).get_columns("billing_calls")}
    engine.dispose()
    migrate("upgrade", "head")
    engine = create_engine(database_url)
    preserved_financial_rows(engine)
    assert {"input_price", "output_price"} <= {column["name"] for column in inspect(engine).get_columns("billing_calls")}
    engine.dispose()


def test_later_b1_existing_price_columns_are_not_added_twice(tmp_path):
    database_url, migrate = migration_runner(tmp_path, "later-b1.sqlite")
    migrate("upgrade", "b1c2d3e4f5a6")
    seed_early_b1(database_url)
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE billing_calls ADD COLUMN input_price VARCHAR(64) NOT NULL DEFAULT '0.25'"))
        connection.execute(text("ALTER TABLE billing_calls ADD COLUMN output_price VARCHAR(64) NOT NULL DEFAULT '1.25'"))
    engine.dispose()
    migrate("upgrade", "head")
    engine = create_engine(database_url)
    preserved_financial_rows(engine)
    with engine.connect() as connection:
        assert connection.execute(text("SELECT input_price,output_price FROM billing_calls")).one() == ("0.25", "1.25")
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar() == HEAD
    engine.dispose()
