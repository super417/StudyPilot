import base64
from pathlib import Path
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from app.core.config import get_settings


def test_grade_quote_migration_roundtrip(tmp_path, monkeypatch):
    db = tmp_path / 'quote-migration.db'
    url = f'sqlite:///{db.as_posix()}'
    monkeypatch.setenv('DATABASE_URL', url)
    monkeypatch.setenv('DB_PASSWORD', 'temporary-test-password')
    monkeypatch.setenv('AES_KEY', base64.b64encode(bytes(range(32))).decode('ascii'))
    get_settings.cache_clear()
    backend = Path(__file__).resolve().parents[1]
    config = Config(str(backend / 'alembic.ini'))
    config.set_main_option('script_location', str(backend / 'alembic'))
    try:
        command.upgrade(config, 'c3a1b2c3d4e5')
        engine = create_engine(url)
        with engine.begin() as c:
            c.execute(text("INSERT INTO users (id,username,password_hash,created_at,failed_login_count,last_active_at) VALUES ('11111111111111111111111111111111','legacy','x',CURRENT_TIMESTAMP,0,CURRENT_TIMESTAMP)"))
            c.execute(text("INSERT INTO mastery_evidence (id,user_id,evidence_type,result,created_at) VALUES ('22222222222222222222222222222222','11111111111111111111111111111111','quiz','wrong',CURRENT_TIMESTAMP)"))
        engine.dispose()
        command.upgrade(config, 'd4e5f6a7b8c1')
        engine = create_engine(url)
        with engine.connect() as c:
            assert c.execute(text('SELECT source_quote, quote_check FROM mastery_evidence')).one() == (None,None)
        engine.dispose()
        command.downgrade(config, 'c3a1b2c3d4e5')
        engine = create_engine(url)
        assert 'quote_check' not in {c['name'] for c in inspect(engine).get_columns('mastery_evidence')}
        with engine.connect() as c: assert c.execute(text('SELECT COUNT(*) FROM mastery_evidence')).scalar_one() == 1
        engine.dispose()
        command.upgrade(config, 'd4e5f6a7b8c1')
        engine = create_engine(url)
        assert 'quote_check' in {c['name'] for c in inspect(engine).get_columns('mastery_evidence')}
        engine.dispose()
    finally:
        get_settings.cache_clear()
