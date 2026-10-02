import base64
from datetime import datetime, timedelta, timezone
import os
import unittest
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["DB_PASSWORD"] = "test-only-password"
os.environ["AES_KEY"] = base64.b64encode(bytes(range(32))).decode("ascii")
os.environ["SESSION_TIMEOUT_MINUTES"] = "30"

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.services.session_service import COOKIE_NAME, session_store


get_settings.cache_clear()


class AuthRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.session_factory = sessionmaker(
            bind=cls.engine, class_=Session, expire_on_commit=False
        )

        def override_get_db():
            session = cls.session_factory()
            try:
                yield session
            finally:
                session.close()

        app.dependency_overrides[get_db] = override_get_db

    @classmethod
    def tearDownClass(cls) -> None:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(cls.engine)
        cls.engine.dispose()

    def setUp(self) -> None:
        Base.metadata.create_all(self.engine)
        session_store.clear()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()
        session_store.clear()
        Base.metadata.drop_all(self.engine)

    def _register(self, username: str = "route-learner"):
        return self.client.post(
            "/api/auth/register",
            json={"username": username, "password": "placeholder-password"},
        )

    def _login(self, username: str = "route-learner"):
        return self.client.post(
            "/api/auth/login",
            json={"username": username, "password": "placeholder-password"},
        )

    def test_register_success_duplicate_and_validation(self) -> None:
        response = self._register()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["status"], "ok")
        self.assertNotIn("password", response.text.lower())

        duplicate = self._register()
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(duplicate.json()["code"], "USERNAME_TAKEN")

        invalid = self.client.post(
            "/api/auth/register",
            json={"username": "ab", "password": "short"},
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["code"], "VALIDATION")

    def test_login_sets_http_only_cookie_and_me_returns_ok(self) -> None:
        self.assertEqual(self._register().status_code, 201)

        login = self._login()
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["status"], "ok")
        self.assertIn(COOKIE_NAME, self.client.cookies)
        set_cookie = login.headers["set-cookie"].lower()
        self.assertIn("httponly", set_cookie)
        self.assertIn("samesite=lax", set_cookie)

        me = self.client.get("/api/auth/me")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["status"], "ok")
        self.assertEqual(me.json()["dataLoad"]["status"], "ok")
        summary = me.json()["dataLoad"]["data"]
        self.assertEqual(
            summary,
            {
                "apiConfig": {"configured": False, "isVerified": False},
                "plans": 0,
                "checkIns": 0,
                "mistakes": 0,
                "weeklyReviews": 0,
            },
        )
        self.assertNotIn("password_hash", me.text)
        self.assertNotIn("api_key_cipher", me.text)

    def test_wrong_password_fifth_attempt_locks_account(self) -> None:
        self.assertEqual(self._register().status_code, 201)
        for _ in range(4):
            response = self.client.post(
                "/api/auth/login",
                json={
                    "username": "route-learner",
                    "password": "wrong-placeholder-password",
                },
            )
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.json()["code"], "INVALID_CREDENTIALS")

        locked = self.client.post(
            "/api/auth/login",
            json={
                "username": "route-learner",
                "password": "wrong-placeholder-password",
            },
        )
        self.assertEqual(locked.status_code, 423)
        self.assertEqual(locked.json()["code"], "LOCKED")
        self.assertIsInstance(locked.json()["retryAfterSeconds"], int)

    def test_logout_clears_session_and_me_requires_authentication(self) -> None:
        anonymous_logout = self.client.post("/api/auth/logout")
        self.assertEqual(anonymous_logout.status_code, 200)
        self.assertEqual(anonymous_logout.json(), {"status": "ok"})

        self._register()
        self._login()

        logout = self.client.post("/api/auth/logout")
        self.assertEqual(logout.status_code, 200)
        self.assertEqual(logout.json(), {"status": "ok"})

        me = self.client.get("/api/auth/me")
        self.assertEqual(me.status_code, 401)
        self.assertEqual(me.json()["code"], "UNAUTHENTICATED")

    def test_expired_session_is_removed_and_me_returns_expired(self) -> None:
        self._register()
        self._login()
        token = self.client.cookies.get(COOKIE_NAME)
        self.assertIsNotNone(token)
        session_store.sessions[token].last_active_at = datetime.now(timezone.utc) - timedelta(
            minutes=31
        )

        me = self.client.get("/api/auth/me")
        self.assertEqual(me.status_code, 401)
        self.assertEqual(me.json()["code"], "SESSION_EXPIRED")
        self.assertNotIn(token, session_store.sessions)

    def test_data_load_failure_degrades_without_logging_out(self) -> None:
        self._register()
        with patch(
            "app.services.auth_service.load_user_data",
            side_effect=RuntimeError("password api_key_cipher database://secret"),
        ):
            login = self._login()

        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["dataLoad"]["status"], "degraded")
        self.assertEqual(login.json()["dataLoad"]["code"], "DATA_LOAD_FAILED")
        self.assertNotIn("database://", login.text)
        self.assertNotIn("api_key_cipher", login.text)
        self.assertNotIn("password api_key_cipher", login.text)

        me = self.client.get("/api/auth/me")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["status"], "ok")


if __name__ == "__main__":
    unittest.main()
