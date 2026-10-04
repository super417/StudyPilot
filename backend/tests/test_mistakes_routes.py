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
            set(item.keys()),
            {"id", "question", "subject", "reviewStatus", "nextReviewAt", "due", "createdAt"},
        )

    def test_subject_saved_on_create_and_update(self) -> None:
        created = self.client.post(
            "/api/mistakes", json={"question": "求极限", "subject": " 高等数学 "}
        ).json()["mistake"]
        self.assertEqual(created["subject"], "高等数学")

        updated = self.client.put(
            f"/api/mistakes/{created['id']}",
            json={"question": "求极限", "subject": "线性代数"},
        ).json()["mistake"]
        self.assertEqual(updated["subject"], "线性代数")

        listed = self.client.get("/api/mistakes").json()["mistakes"]
        self.assertEqual(listed[0]["subject"], "线性代数")

        too_long = self.client.post(
            "/api/mistakes", json={"question": "题", "subject": "科" * 65}
        )
        self.assertEqual(too_long.status_code, 400)
        self.assertEqual(too_long.json()["code"], "VALIDATION")

    def test_list_marks_scheduled_reviews_that_are_due(self) -> None:
        from datetime import datetime, timedelta, timezone

        now = datetime.now(timezone.utc)
        due = self._make_mistake(self.user.id, "到期", "scheduled")
        due.next_review_at = now - timedelta(hours=1)
        later = self._make_mistake(self.user.id, "未到期", "scheduled")
        later.next_review_at = now + timedelta(days=3)
        done = self._make_mistake(self.user.id, "已完成", "done")
        done.next_review_at = now - timedelta(days=1)
        self.session.commit()

        body = self.client.get("/api/mistakes").json()
        flags = {item["question"]: item["due"] for item in body["mistakes"]}
        self.assertEqual(flags, {"到期": True, "未到期": False, "已完成": False})
        self.assertEqual(body["dueCount"], 1)
        self.assertEqual(body["pendingCount"], 0)

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
                "subject",
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
        self.assertIsNotNone(body["mistake"]["nextReviewAt"])

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

    def test_delete_mistake_removes_row(self) -> None:
        mistake = self._make_mistake(self.user.id, "待删除", "pending")
        response = self.client.delete(f"/api/mistakes/{mistake.id}")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["deletedId"], str(mistake.id))

        listed = self.client.get("/api/mistakes")
        self.assertEqual(listed.json()["pendingCount"], 0)
        self.assertEqual(listed.json()["mistakes"], [])

        again = self.client.delete(f"/api/mistakes/{mistake.id}")
        self.assertEqual(again.status_code, 404)
        self.assertEqual(again.json()["code"], "NOT_FOUND")

    def test_delete_foreign_mistake_returns_404(self) -> None:
        other = User(username=f"other-{os.urandom(4).hex()}", password_hash="x")
        self.session.add(other)
        self.session.commit()
        foreign = self._make_mistake(other.id, "别人的题")
        response = self.client.delete(f"/api/mistakes/{foreign.id}")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "NOT_FOUND")
        self.session.expire_all()
        self.assertIsNotNone(self.session.get(Mistake, foreign.id))

    def test_update_mistake_content(self) -> None:
        mistake = self._make_mistake(self.user.id, "旧题干", "pending")
        response = self.client.put(
            f"/api/mistakes/{mistake.id}",
            json={
                "question": "新题干",
                "myAnswer": "新答案",
                "whyWrong": "概念混淆",
                "correctUnderstanding": "应先画图",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()["mistake"]
        self.assertEqual(body["question"], "新题干")
        self.assertEqual(body["myAnswer"], "新答案")
        self.assertEqual(body["whyWrong"], "概念混淆")
        self.assertEqual(body["correctUnderstanding"], "应先画图")
        self.assertEqual(body["reviewStatus"], "pending")

        self.session.expire_all()
        row = self.session.get(Mistake, mistake.id)
        self.assertEqual(row.question, "新题干")
        self.assertEqual(row.my_answer, "新答案")

    def test_update_empty_question_returns_400(self) -> None:
        mistake = self._make_mistake(self.user.id, "题")
        response = self.client.put(
            f"/api/mistakes/{mistake.id}",
            json={"question": "   "},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "VALIDATION")

    # --- POST /api/mistakes/ocr ---------------------------------------------

    def test_ocr_rejects_non_image(self) -> None:
        response = self.client.post(
            "/api/mistakes/ocr",
            files={"image": ("a.txt", b"hello", "text/plain")},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "VALIDATION")

    def test_ocr_without_api_config_returns_no_api_key(self) -> None:
        response = self.client.post(
            "/api/mistakes/ocr",
            files={"image": ("q.png", b"\x89PNG fake", "image/png")},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "NO_API_KEY")

    def test_ocr_sends_image_and_returns_text(self) -> None:
        from unittest import mock

        from app.services import ocr_service
        from app.services.ai_proxy import ResolvedCredential

        sent: dict = {}

        class FakeResponse:
            status_code = 200

            def json(self):
                return {"choices": [{"message": {"content": "  1. 求极限 lim x→0 sinx/x  "}}]}

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def post(self, url, headers, json):
                sent["url"] = url
                sent["json"] = json
                return FakeResponse()

        credential = ResolvedCredential(
            api_key="sk-test", model_type="gpt-4o", base_url="https://x/v1/chat/completions"
        )
        with mock.patch.object(ocr_service, "resolve_credential", return_value=credential), \
                mock.patch.object(ocr_service.httpx, "AsyncClient", FakeClient):
            response = self.client.post(
                "/api/mistakes/ocr",
                files={"image": ("q.png", b"\x89PNG fake", "image/png")},
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["text"], "1. 求极限 lim x→0 sinx/x")
        parts = sent["json"]["messages"][0]["content"]
        self.assertEqual(sent["json"]["model"], "gpt-4o")
        self.assertTrue(parts[1]["image_url"]["url"].startswith("data:image/png;base64,"))
        self.assertNotIn("sk-test", response.text)


if __name__ == "__main__":
    unittest.main()
