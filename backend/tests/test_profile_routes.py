import base64
import os
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.entities import User
from app.services.session_service import session_store


class ProfileRouteTests(unittest.TestCase):
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
        username = f"profile-{os.urandom(8).hex()}"
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

    def test_get_profile_defaults_empty(self) -> None:
        response = self.client.get("/api/profile")
        self.assertEqual(response.status_code, 200, response.text)
        profile = response.json()["profile"]
        self.assertEqual(profile["nickname"], "")
        self.assertEqual(profile["direction"], "")
        self.assertEqual(profile["targetSchool"], "")
        self.assertEqual(profile["bio"], "")

    def test_put_profile_persists_and_reads_back(self) -> None:
        put = self.client.put(
            "/api/profile",
            json={
                "nickname": "小明",
                "direction": "计算机",
                "targetSchool": "某某大学",
                "bio": "冲刺考研",
            },
        )
        self.assertEqual(put.status_code, 200, put.text)
        self.assertEqual(put.json()["profile"]["nickname"], "小明")

        get = self.client.get("/api/profile")
        self.assertEqual(get.status_code, 200, get.text)
        self.assertEqual(
            get.json()["profile"],
            {
                "nickname": "小明",
                "direction": "计算机",
                "targetSchool": "某某大学",
                "bio": "冲刺考研",
            },
        )

        self.session.expire_all()
        user = self.session.get(User, self.user.id)
        self.assertEqual(user.nickname, "小明")
        self.assertEqual(user.target_school, "某某大学")

    def test_put_rejects_too_long_bio(self) -> None:
        response = self.client.put(
            "/api/profile",
            json={"nickname": "a", "direction": "", "targetSchool": "", "bio": "x" * 281},
        )
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["code"], "VALIDATION")

    def test_unauthenticated_returns_401(self) -> None:
        self.client.cookies.clear()
        response = self.client.get("/api/profile")
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
