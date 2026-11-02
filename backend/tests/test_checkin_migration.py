import base64
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text, inspect
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError
from app.core.config import get_settings


@pytest.mark.parametrize("legacy_daily_unique", [False, True])
def test_unique_checkin_migration_roundtrip(tmp_path, monkeypatch, legacy_daily_unique):
    url = f'sqlite:///{(tmp_path / "migration.db").as_posix()}'
    monkeypatch.setenv('DATABASE_URL', url)
    monkeypatch.setenv('DB_PASSWORD', 'temporary-test-password')
    monkeypatch.setenv('AES_KEY', base64.b64encode(bytes(range(32))).decode('ascii'))
    get_settings.cache_clear()
    backend = Path(__file__).resolve().parents[1]
    config = Config(str(backend / 'alembic.ini'))
    config.set_main_option('script_location', str(backend / 'alembic'))
    try:
        command.upgrade(config, 'e9a0b1c2d3e4')
        engine = create_engine(url)
        with engine.begin() as c:
            c.execute(text("INSERT INTO users (id,username,password_hash,created_at,failed_login_count,last_active_at) VALUES ('11111111111111111111111111111111','legacy','x',CURRENT_TIMESTAMP,0,CURRENT_TIMESTAMP)"))
            for idx, minutes in ([(1, 30)] if legacy_daily_unique else [(1, 30), (2, 90)]):
                c.execute(text("INSERT INTO check_ins (id,user_id,check_date,duration_minutes,difficulty,energy,created_at) VALUES (:id,'11111111111111111111111111111111','2026-11-02',:minutes,3,3,:created)"), {'id': str(idx).zfill(32), 'minutes': minutes, 'created': f'2026-11-02 0{idx}:00:00'})
        if legacy_daily_unique:
            with engine.begin() as c:
                with Operations(MigrationContext.configure(c)).batch_alter_table('check_ins') as batch:
                    batch.create_unique_constraint('uq_check_ins_user_date', ['user_id', 'check_date'])
            command.stamp(config, 'f1b2c3d4e5f6')
        engine.dispose()
        command.upgrade(config, 'a2b3c4d5e6f7')
        engine = create_engine(url)
        with engine.connect() as c:
            assert c.execute(text('SELECT duration_minutes FROM check_ins')).scalars().all() == ([30] if legacy_daily_unique else [30, 90])
        with engine.connect() as c:
            assert c.execute(text('SELECT task_id FROM check_ins')).scalars().all() == ([None] if legacy_daily_unique else [None, None])
        engine.dispose()
        command.downgrade(config, 'e9a0b1c2d3e4')
        command.upgrade(config, 'a2b3c4d5e6f7')
        engine = create_engine(url)
        with engine.connect() as c:
            columns = {item['name'] for item in inspect(c).get_columns('check_ins')}
            assert 'task_id' in columns
            constraints = {item['name'] for item in inspect(c).get_unique_constraints('check_ins')}
            assert 'uq_check_ins_user_task' in constraints
            assert 'uq_check_ins_user_date' not in constraints
            assert c.execute(text('SELECT count(*) FROM check_ins')).scalar_one() == (1 if legacy_daily_unique else 2)
        engine.dispose()
    finally:
        get_settings.cache_clear()
