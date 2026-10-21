"""Batch 17 commit 1: users.assistant_name migration round-trip."""

from __future__ import annotations

import base64
import os
import tempfile
import unittest
from pathlib import Path

from sqlalchemy import create_engine, inspect

from app.core.config import get_settings


class AssistantNameMigrationTests(unittest.TestCase):
    def test_upgrade_downgrade_upgrade_on_temporary_sqlite(self) -> None:
        from alembic import command
        from alembic.config import Config

        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / "batch17-assistant-name.db"
            previous = {
                name: os.environ.get(name)
                for name in ("DATABASE_URL", "DB_PASSWORD", "AES_KEY")
            }
            os.environ["DATABASE_URL"] = f"sqlite:///{database.as_posix()}"
            os.environ["DB_PASSWORD"] = "temporary-test-password"
            os.environ["AES_KEY"] = base64.b64encode(bytes(range(32))).decode("ascii")
            get_settings.cache_clear()
            backend = Path(__file__).resolve().parents[1]
            config = Config(str(backend / "alembic.ini"))
            config.set_main_option("script_location", str(backend / "alembic"))
            config.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])
            try:
                command.upgrade(config, "c8d9e0f1a2b3")
                self._assert_column(database, True)
                command.downgrade(config, "b7c8d9e0f1a2")
                self._assert_column(database, False)
                command.upgrade(config, "c8d9e0f1a2b3")
                self._assert_column(database, True)
            finally:
                get_settings.cache_clear()
                for name, value in previous.items():
                    if value is None:
                        os.environ.pop(name, None)
                    else:
                        os.environ[name] = value

    def _assert_column(self, database: Path, present: bool) -> None:
        engine = create_engine(f"sqlite:///{database.as_posix()}")
        columns = {
            column["name"] for column in inspect(engine).get_columns("users")
        }
        engine.dispose()
        self.assertEqual("assistant_name" in columns, present)


if __name__ == "__main__":
    unittest.main()
