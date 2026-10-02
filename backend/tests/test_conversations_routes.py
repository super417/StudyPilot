import base64
import os
import unittest
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.entities import ChatMessage, Conversation, User
from app.services.conversation_service import MAX_MESSAGES_PER_CONVERSATION
from app.services.session_service import session_store


class ConversationRouteTests(unittest.TestCase):
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
        session_store.clear()
        self.client = TestClient(app)
        self.user = self._sign_up("conv-route")

    def tearDown(self) -> None:
        self.client.close()
        self.session.close()
        session_store.clear()
        Base.metadata.drop_all(self.engine)

    def _sign_up(self, prefix: str) -> User:
        username = f"{prefix}-{os.urandom(8).hex()}"
        registration = self.client.post(
            "/api/auth/register",
            json={"username": username, "password": "placeholder-password"},
        )
        self.assertEqual(registration.status_code, 201, registration.text)
        login = self.client.post(
            "/api/auth/login",
            json={"username": username, "password": "placeholder-password"},
        )
        self.assertEqual(login.status_code, 200, login.text)
        user = self.session.scalar(select(User).where(User.username == username))
        self.assertIsNotNone(user)
        return user

    def _create(self, title: str | None = None, context_type: str | None = None) -> dict:
        body: dict = {}
        if title is not None:
            body["title"] = title
        if context_type is not None:
            body["contextType"] = context_type
        response = self.client.post("/api/conversations", json=body)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["conversation"]

    def _message_count(self, conversation_id: str) -> int:
        self.session.expire_all()
        return (
            self.session.scalar(
                select(func.count())
                .select_from(ChatMessage)
                .where(ChatMessage.conversation_id == uuid.UUID(conversation_id))
            )
            or 0
        )

    def test_create_persists_owned_conversation(self) -> None:
        created = self._create(title="线代复习", context_type="plan")

        self.assertEqual(created["title"], "线代复习")
        self.assertEqual(created["contextType"], "plan")
        rows = list(self.session.scalars(select(Conversation)))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].user_id, self.user.id)

    def test_create_defaults_title_and_rejects_unknown_context(self) -> None:
        created = self._create()
        self.assertEqual(created["title"], "新对话")
        self.assertIsNone(created["contextType"])

        bad = self.client.post(
            "/api/conversations", json={"contextType": "telepathy"}
        )
        self.assertEqual(bad.status_code, 422, bad.text)
        self.assertEqual(bad.json()["code"], "VALIDATION")
        self.assertEqual(len(list(self.session.scalars(select(Conversation)))), 1)

    def test_list_orders_by_recent_activity(self) -> None:
        first = self._create(title="第一条")
        second = self._create(title="第二条")
        self.client.put(
            f"/api/conversations/{first['id']}/messages",
            json={"messages": [{"role": "user", "content": "再聊一句"}]},
        )

        listed = self.client.get("/api/conversations")
        self.assertEqual(listed.status_code, 200, listed.text)
        ids = [c["id"] for c in listed.json()["conversations"]]
        self.assertEqual(ids, [first["id"], second["id"]])

    def test_replace_messages_keeps_order_and_content(self) -> None:
        conversation = self._create()
        payload = {
            "messages": [
                {"role": "user", "content": "什么是特征值"},
                {"role": "assistant", "content": "特征值是……"},
            ]
        }
        response = self.client.put(
            f"/api/conversations/{conversation['id']}/messages", json=payload
        )

        self.assertEqual(response.status_code, 200, response.text)
        roles = [m["role"] for m in response.json()["messages"]]
        self.assertEqual(roles, ["user", "assistant"])
        contents = [m["content"] for m in response.json()["messages"]]
        self.assertEqual(contents, ["什么是特征值", "特征值是……"])

        # 再存一次是**整体替换**，不是追加
        self.client.put(
            f"/api/conversations/{conversation['id']}/messages",
            json={"messages": [{"role": "user", "content": "只留这一条"}]},
        )
        reloaded = self.client.get(
            f"/api/conversations/{conversation['id']}/messages"
        )
        self.assertEqual(len(reloaded.json()["messages"]), 1)
        self.assertEqual(self._message_count(conversation["id"]), 1)

    def test_replace_messages_trims_to_per_conversation_limit(self) -> None:
        conversation = self._create()
        many = [
            {"role": "user", "content": f"第 {i} 条"} for i in range(140)
        ]
        response = self.client.put(
            f"/api/conversations/{conversation['id']}/messages",
            json={"messages": many},
        )

        self.assertEqual(response.status_code, 200, response.text)
        stored = response.json()["messages"]
        self.assertEqual(len(stored), MAX_MESSAGES_PER_CONVERSATION)
        self.assertEqual(stored[-1]["content"], "第 139 条")

    def test_replace_messages_rejects_bad_role_without_wiping(self) -> None:
        conversation = self._create()
        self.client.put(
            f"/api/conversations/{conversation['id']}/messages",
            json={"messages": [{"role": "user", "content": "保留我"}]},
        )

        response = self.client.put(
            f"/api/conversations/{conversation['id']}/messages",
            json={"messages": [{"role": "system", "content": "不该落库"}]},
        )

        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["code"], "VALIDATION")
        reloaded = self.client.get(
            f"/api/conversations/{conversation['id']}/messages"
        )
        self.assertEqual(
            [m["content"] for m in reloaded.json()["messages"]], ["保留我"]
        )

    def test_delete_removes_conversation_and_its_messages(self) -> None:
        conversation = self._create(title="待删除")
        self.client.put(
            f"/api/conversations/{conversation['id']}/messages",
            json={"messages": [{"role": "user", "content": "会被一起删掉"}]},
        )
        self.assertEqual(self._message_count(conversation["id"]), 1)

        response = self.client.delete(f"/api/conversations/{conversation['id']}")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["deletedId"], conversation["id"])
        self.assertEqual(self._message_count(conversation["id"]), 0)
        self.assertEqual(list(self.session.scalars(select(Conversation))), [])
        self.assertEqual(
            self.client.get("/api/conversations").json()["conversations"], []
        )

    def test_delete_is_scoped_to_owner(self) -> None:
        conversation = self._create(title="我的会话")
        owner_client = self.client

        self.client = TestClient(app)
        self._sign_up("conv-intruder")
        stolen = self.client.delete(f"/api/conversations/{conversation['id']}")

        self.assertEqual(stolen.status_code, 404, stolen.text)
        self.assertEqual(stolen.json()["code"], "CONVERSATION_NOT_FOUND")
        self.assertEqual(len(list(self.session.scalars(select(Conversation)))), 1)

        # 归属校验对读消息同样生效
        peek = self.client.get(f"/api/conversations/{conversation['id']}/messages")
        self.assertEqual(peek.status_code, 404)
        self.client = owner_client

    def test_rename_keeps_title_when_blank(self) -> None:
        conversation = self._create(title="原名")

        renamed = self.client.patch(
            f"/api/conversations/{conversation['id']}", json={"title": "改名后"}
        )
        self.assertEqual(renamed.status_code, 200, renamed.text)
        self.assertEqual(renamed.json()["conversation"]["title"], "改名后")

        blank = self.client.patch(
            f"/api/conversations/{conversation['id']}", json={"title": "   "}
        )
        self.assertEqual(blank.json()["conversation"]["title"], "改名后")

    def test_malformed_id_is_not_found(self) -> None:
        response = self.client.delete("/api/conversations/not-a-uuid")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "CONVERSATION_NOT_FOUND")

    def test_routes_require_authentication(self) -> None:
        conversation = self._create()
        self.client.cookies.clear()

        self.assertEqual(self.client.get("/api/conversations").status_code, 401)
        self.assertEqual(
            self.client.post("/api/conversations", json={}).status_code, 401
        )
        self.assertEqual(
            self.client.delete(f"/api/conversations/{conversation['id']}").status_code,
            401,
        )
        self.assertEqual(
            self.client.put(
                f"/api/conversations/{conversation['id']}/messages",
                json={"messages": []},
            ).status_code,
            401,
        )
        # 未鉴权不能删掉任何东西
        self.assertEqual(len(list(self.session.scalars(select(Conversation)))), 1)


if __name__ == "__main__":
    unittest.main()
