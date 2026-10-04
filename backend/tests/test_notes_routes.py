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
from app.models.entities import Note, User
from app.services.session_service import session_store


class NoteRouteTests(unittest.TestCase):
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
        username = f"notes-{os.urandom(8).hex()}"
        self.client = TestClient(app)
        session_store.clear()
        registration = self.client.post(
            "/api/auth/register",
            json={"username": username, "password": "placeholder-password"},
        )
        self.assertEqual(registration.status_code, 201, registration.text)
        self.user = self.session.scalar(select(User).where(User.username == username))
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

    def test_create_list_update_delete(self) -> None:
        created = self.client.post(
            "/api/notes",
            json={"title": "中值定理", "subject": "高数", "body": "先画图"},
        )
        self.assertEqual(created.status_code, 201, created.text)
        note_id = created.json()["note"]["id"]

        listed = self.client.get("/api/notes")
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(len(listed.json()["notes"]), 1)
        self.assertEqual(listed.json()["notes"][0]["title"], "中值定理")

        updated = self.client.put(
            f"/api/notes/{note_id}",
            json={"title": "中值定理易错", "subject": "高等数学", "body": "罗尔是特例"},
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["note"]["title"], "中值定理易错")

        deleted = self.client.delete(f"/api/notes/{note_id}")
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual(self.client.get("/api/notes").json()["notes"], [])

    def test_empty_title_rejected(self) -> None:
        response = self.client.post("/api/notes", json={"title": "  "})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "VALIDATION")

    def test_foreign_note_is_not_found(self) -> None:
        other = User(username=f"other-{os.urandom(4).hex()}", password_hash="x")
        self.session.add(other)
        self.session.commit()
        note = Note(user_id=other.id, title="别人的笔记", subject="", body="")
        self.session.add(note)
        self.session.commit()

        response = self.client.delete(f"/api/notes/{note.id}")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "NOT_FOUND")
        self.session.expire_all()
        self.assertIsNotNone(self.session.get(Note, note.id))


if __name__ == "__main__":
    unittest.main()
