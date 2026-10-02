import base64
import os
import unittest
from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.entities import User, WeeklyReview
from app.services.session_service import session_store


class WeeklyReviewRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._environment = {
            name: os.environ.get(name)
            for name in (
                "DATABASE_URL",
                "DB_PASSWORD",
                "AES_KEY",
                "SESSION_TIMEOUT_MINUTES",
            )
        }
        os.environ["DATABASE_URL"] = "sqlite:///:memory:"
        os.environ["DB_PASSWORD"] = "temporary-test-password"
        os.environ["AES_KEY"] = base64.b64encode(bytes(range(32))).decode("ascii")
        os.environ["SESSION_TIMEOUT_MINUTES"] = "30"
        get_settings.cache_clear()
        get_cipher.cache_clear()

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
        session_store.clear()
        get_cipher.cache_clear()
        get_settings.cache_clear()
        for name, value in cls._environment.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def setUp(self) -> None:
        Base.metadata.create_all(self.engine)
        self.session = self.session_factory()
        username = f"weekly-route-{os.urandom(8).hex()}"
        self.client = TestClient(app)
        session_store.clear()
        registration = self.client.post(
            "/api/auth/register",
            json={"username": username, "password": "placeholder-password"},
        )
        self.assertEqual(registration.status_code, 201, registration.text)
        self.user = self.session.scalar(select(User).where(User.username == username))
        self.assertIsNotNone(self.user)
        login = self.client.post(
            "/api/auth/login",
            json={"username": username, "password": "placeholder-password"},
        )
        self.assertEqual(login.status_code, 200, login.text)

    def tearDown(self) -> None:
        self.client.close()
        self.session.close()
        session_store.clear()
        Base.metadata.drop_all(self.engine)

    def _make_review(self) -> WeeklyReview:
        review = WeeklyReview(
            user_id=self.user.id,
            week_start=date(2025, 2, 10),
            week_end=date(2025, 2, 16),
            total_minutes=180,
            streak_days=3,
            completion_rate=75,
            mastery_avg=0,
            mastery_detail={},
        )
        self.session.add(review)
        self.session.commit()
        return review

    # --- GET /api/weekly-reviews/latest ------------------------------------

    def test_latest_returns_review_fields(self) -> None:
        self._make_review()
        response = self.client.get("/api/weekly-reviews/latest")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertIsNotNone(body["review"])
        self.assertEqual(
            set(body["review"].keys()),
            {
                "weekStart",
                "weekEnd",
                "totalMinutes",
                "streakDays",
                "completionRate",
                "masteryAvg",
                "masteryDetail",
                "createdAt",
            },
        )
        self.assertEqual(body["review"]["totalMinutes"], 180)
        self.assertEqual(body["review"]["completionRate"], 75)

    def test_latest_returns_empty_marker_when_none(self) -> None:
        response = self.client.get("/api/weekly-reviews/latest")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertIsNone(body["review"])
        self.assertTrue(body["empty"])

    def test_latest_unauthenticated_returns_401(self) -> None:
        self.client.cookies.clear()
        response = self.client.get("/api/weekly-reviews/latest")
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
