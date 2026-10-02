import base64
import os
import unittest
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.entities import Mistake, User
from app.services.session_service import session_store


class MistakeRouteTests(unittest.TestCase):
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
        username = f"mistake-route-{os.urandom(8).hex()}"
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

    def _make_mistake(
        self, user_id, question: str, review_status: str = "pending"
    ) -> Mistake:
        mistake = Mistake(
            user_id=user_id,
            question=question,
            my_answer="我的答案",
            why_wrong="粗心",
            correct_understanding="正确理解",
            review_status=review_status,
        )
        self.session.add(mistake)
        self.session.commit()
        return mistake

    # --- GET /api/mistakes --------------------------------------------------

    def test_list_returns_structure_and_pending_count(self) -> None:
        self._make_mistake(self.user.id, "题1", "pending")
        self._make_mistake(self.user.id, "题2", "scheduled")
        self._make_mistake(self.user.id, "题3", "pending")

        response = self.client.get("/api/mistakes")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["pendingCount"], 2)
        self.assertEqual(len(body["mistakes"]), 3)
        item = body["mistakes"][0]
        self.assertEqual(
            set(item.keys()), {"id", "question", "reviewStatus", "createdAt"}
        )

    def test_list_unauthenticated_returns_401(self) -> None:
        self.client.cookies.clear()
        response = self.client.get("/api/mistakes")
        self.assertEqual(response.status_code, 401)

    # --- POST /api/mistakes -----------------------------------------------

    def test_create_mistake_persists_and_lists(self) -> None:
        response = self.client.post(
            "/api/mistakes",
            json={
                "question": "求极限 lim x→0 sinx/x",
                "myAnswer": "0",
                "whyWrong": "记错了重要极限",
                "correctUnderstanding": "极限为 1",
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["mistake"]["question"], "求极限 lim x→0 sinx/x")
        self.assertEqual(body["mistake"]["reviewStatus"], "pending")

        listed = self.client.get("/api/mistakes")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["pendingCount"], 1)
        self.assertEqual(len(listed.json()["mistakes"]), 1)

    def test_create_empty_question_returns_400(self) -> None:
        response = self.client.post(
            "/api/mistakes",
            json={"question": "   "},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "VALIDATION")

    # --- GET /api/mistakes/{id} --------------------------------------------

    def test_detail_returns_full_fields(self) -> None:
        mistake = self._make_mistake(self.user.id, "详情题")
        response = self.client.get(f"/api/mistakes/{mistake.id}")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(
            set(body["mistake"].keys()),
            {
                "id",
                "question",
                "myAnswer",
                "whyWrong",
                "correctUnderstanding",
                "reviewStatus",
                "nextReviewAt",
                "createdAt",
            },
        )
        self.assertEqual(body["mistake"]["question"], "详情题")

    def test_detail_unknown_returns_404(self) -> None:
        response = self.client.get(f"/api/mistakes/{uuid.uuid4()}")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "NOT_FOUND")

    def test_detail_malformed_id_returns_404(self) -> None:
        response = self.client.get("/api/mistakes/not-a-uuid")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "NOT_FOUND")

    def test_detail_foreign_mistake_returns_404(self) -> None:
        other = User(username=f"other-{os.urandom(4).hex()}", password_hash="x")
        self.session.add(other)
        self.session.commit()
        foreign = self._make_mistake(other.id, "他人题")
        response = self.client.get(f"/api/mistakes/{foreign.id}")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "NOT_FOUND")

    # --- PATCH /api/mistakes/{id}/review-status ----------------------------

    def test_patch_review_status_updates(self) -> None:
        mistake = self._make_mistake(self.user.id, "题", "pending")
        response = self.client.patch(
            f"/api/mistakes/{mistake.id}/review-status",
            json={"status": "scheduled"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["mistake"]["reviewStatus"], "scheduled")

        self.session.expire_all()
        reloaded = self.session.scalar(
            select(Mistake).where(Mistake.id == mistake.id)
        )
        self.assertEqual(reloaded.review_status, "scheduled")

    def test_patch_invalid_status_returns_400(self) -> None:
        mistake = self._make_mistake(self.user.id, "题")
        response = self.client.patch(
            f"/api/mistakes/{mistake.id}/review-status",
            json={"status": "archived"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "VALIDATION")

    def test_patch_unknown_returns_404(self) -> None:
        response = self.client.patch(
            f"/api/mistakes/{uuid.uuid4()}/review-status",
            json={"status": "done"},
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "NOT_FOUND")

    def test_patch_unauthenticated_returns_401(self) -> None:
        mistake = self._make_mistake(self.user.id, "题")
        self.client.cookies.clear()
        response = self.client.patch(
            f"/api/mistakes/{mistake.id}/review-status",
            json={"status": "done"},
        )
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
