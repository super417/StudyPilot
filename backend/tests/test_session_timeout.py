"""Session timeout unit tests (task 13.5).

Inject a controllable clock: activity within 30 minutes stays valid;
crossing the timeout invalidates and drops the session.
"""

from __future__ import annotations

import base64
import os
import unittest
import uuid
from datetime import datetime, timedelta, timezone

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.services.session_service import SessionStore


class SessionTimeoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._environment = {
            name: os.environ.get(name)
            for name in ("DATABASE_URL", "DB_PASSWORD", "AES_KEY", "SESSION_TIMEOUT_MINUTES")
        }
        os.environ["DATABASE_URL"] = "sqlite:///:memory:"
        os.environ["DB_PASSWORD"] = "temporary-test-password"
        os.environ["AES_KEY"] = base64.b64encode(bytes(range(32))).decode("ascii")
        os.environ["SESSION_TIMEOUT_MINUTES"] = "30"
        get_settings.cache_clear()
        get_cipher.cache_clear()

    @classmethod
    def tearDownClass(cls) -> None:
        get_cipher.cache_clear()
        get_settings.cache_clear()
        for name, value in cls._environment.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def setUp(self) -> None:
        self.store = SessionStore()
        self.user_id = uuid.uuid4()
        self.t0 = datetime(2026, 4, 1, 10, 0, tzinfo=timezone.utc)

    def test_within_timeout_refreshes_and_stays_valid(self) -> None:
        token = self.store.create(self.user_id, now=self.t0)
        lookup = self.store.get_and_refresh(token, now=self.t0 + timedelta(minutes=29, seconds=59))
        self.assertFalse(lookup.expired)
        self.assertIsNotNone(lookup.record)
        self.assertEqual(lookup.record.user_id, self.user_id)
        self.assertEqual(lookup.record.last_active_at, self.t0 + timedelta(minutes=29, seconds=59))

    def test_past_timeout_expires_and_removes_session(self) -> None:
        token = self.store.create(self.user_id, now=self.t0)
        lookup = self.store.get_and_refresh(token, now=self.t0 + timedelta(minutes=30, seconds=1))
        self.assertTrue(lookup.expired)
        self.assertIsNone(lookup.record)
        self.assertNotIn(token, self.store.sessions)

    def test_exactly_timeout_boundary_still_valid(self) -> None:
        # Spec: expire when now - last_active_at > 30min (strictly greater).
        token = self.store.create(self.user_id, now=self.t0)
        lookup = self.store.get_and_refresh(token, now=self.t0 + timedelta(minutes=30))
        self.assertFalse(lookup.expired)
        self.assertIsNotNone(lookup.record)


if __name__ == "__main__":
    unittest.main()
