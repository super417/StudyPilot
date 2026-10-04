"""Assistant chat route tests (domain gate + SSE + NO_API_KEY)."""

from __future__ import annotations

import base64
import json
import os
import unittest
from contextlib import asynccontextmanager

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.routers.assistant import get_assistant_stream_factory
from app.services.assistant_service import is_off_topic
from app.services.session_service import session_store


def _parse_sse(body: str):
    events = []
    for block in filter(None, (b.strip() for b in body.split("\n\n"))):
        event = None
        data = None
        for line in block.split("\n"):
            if line.startswith("event: "):
                event = line[len("event: ") :]
            elif line.startswith("data: "):
                data = json.loads(line[len("data: ") :])
        events.append((event, data))
    return events


class _BrokenSession:
    """A session whose every query raises — stands in for a database outage.

    Fault injection for the "failure before the first SSE frame" regression:
    the point is where the exception lands, not what caused it.
    """

    def __getattr__(self, name: str):
        def _explode(*_args, **_kwargs):
            raise RuntimeError("database unavailable")

        return _explode


class AssistantServiceUnitTests(unittest.TestCase):
    def test_off_topic_detection(self) -> None:
        self.assertTrue(is_off_topic("推荐个炒股荐股软件"))
        self.assertFalse(is_off_topic("帮我梳理高等数学二重积分"))


class AssistantRouteTests(unittest.TestCase):
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
        self.client = TestClient(app)
        session_store.clear()
        app.dependency_overrides.pop(get_assistant_stream_factory, None)
        username = f"asst-{os.urandom(4).hex()}"
        reg = self.client.post(
            "/api/auth/register",
            json={"username": username, "password": "placeholder-password"},
        )
        self.assertEqual(reg.status_code, 201, reg.text)
        login = self.client.post(
            "/api/auth/login",
            json={"username": username, "password": "placeholder-password"},
        )
        self.assertEqual(login.status_code, 200, login.text)
        self.user_id = login.json()["userId"]

    def tearDown(self) -> None:
        app.dependency_overrides.pop(get_assistant_stream_factory, None)
        self.session.close()
        Base.metadata.drop_all(self.engine)
        session_store.clear()

    def test_chat_requires_auth(self) -> None:
        bare = TestClient(app)
        response = bare.post("/api/assistant/chat", json={"message": "考研数学"})
        self.assertEqual(response.status_code, 401)

    def test_chat_no_api_key_emits_sse_error(self) -> None:
        response = self.client.post(
            "/api/assistant/chat", json={"message": "高数怎么复习"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers.get("content-type", ""))
        events = _parse_sse(response.text)
        self.assertTrue(events)
        self.assertEqual(events[0][0], "error")
        self.assertEqual(events[0][1]["code"], "NO_API_KEY")

    def test_chat_internal_failure_still_emits_sse_error(self) -> None:
        """A crash before the first token must reach the client as an error frame.

        Regression: an exception raised before the generator's first ``yield``
        left Starlette with an already-started response, so the client got
        HTTP 200 and an empty body — the assistant looked like it was thinking
        forever instead of failing. The client must always get a frame it can
        render.
        """
        from types import SimpleNamespace
        import uuid as uuid_mod

        from app.routers.dependencies import get_current_user

        def override_get_db():
            yield _BrokenSession()

        # Restore the real session afterwards. Take it out of the overrides
        # dict rather than off the class: a class attribute fetched through
        # ``self`` arrives as a bound method, which FastAPI cannot inspect.
        previous_db = app.dependency_overrides.get(get_db)
        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
            id=uuid_mod.UUID(self.user_id)
        )
        try:
            response = self.client.post(
                "/api/assistant/chat", json={"message": "高数怎么复习"}
            )
        finally:
            if previous_db is None:
                app.dependency_overrides.pop(get_db, None)
            else:
                app.dependency_overrides[get_db] = previous_db
            app.dependency_overrides.pop(get_current_user, None)

        self.assertEqual(response.status_code, 200)
        events = _parse_sse(response.text)
        self.assertTrue(
            events, "SSE body was empty: the failure never reached the client"
        )
        self.assertEqual(events[0][0], "error")
        self.assertTrue(events[0][1].get("code"))
        self.assertTrue(events[0][1].get("message"))

    def test_chat_off_topic_streams_domain_refusal(self) -> None:
        response = self.client.post(
            "/api/assistant/chat",
            json={"message": "推荐个炒股荐股软件"},
        )
        self.assertEqual(response.status_code, 200)
        events = _parse_sse(response.text)
        tokens = "".join(
            data.get("delta", "") for event, data in events if event == "token"
        )
        self.assertIn("领域拦截", tokens)
        self.assertTrue(any(event == "done" for event, _ in events))

    def test_chat_with_injected_stream_emits_tokens(self) -> None:
        from app.core.crypto import encrypt
        from app.models.entities import ApiConfig, User
        import uuid as uuid_mod

        user = self.session.get(User, uuid_mod.UUID(self.user_id))
        self.assertIsNotNone(user)
        self.session.add(
            ApiConfig(
                user_id=user.id,
                api_key_cipher=encrypt("sk-test-key-xxxxxxxx"),
                model_type="gpt-test",
                base_url="https://example.com/v1/chat/completions",
                is_verified=True,
            )
        )
        self.session.commit()

        @asynccontextmanager
        async def fake_factory(_credential, _payload):
            async def _chunks():
                yield "考研"
                yield "加油"

            yield _chunks()

        app.dependency_overrides[get_assistant_stream_factory] = lambda: fake_factory
        response = self.client.post(
            "/api/assistant/chat",
            json={"message": "高数怎么复习", "context": {"type": "free"}},
        )
        self.assertEqual(response.status_code, 200)
        events = _parse_sse(response.text)
        tokens = "".join(
            data.get("delta", "") for event, data in events if event == "token"
        )
        self.assertEqual(tokens, "考研加油")
        done = [data for event, data in events if event == "done"]
        self.assertTrue(done)
        self.assertNotIn("citations", done[-1])

    def test_chat_done_includes_citation_only_when_a_chunk_was_used(self) -> None:
        from app.core.crypto import encrypt
        from app.models.entities import ApiConfig, User, UserDocument
        import uuid as uuid_mod

        user = self.session.get(User, uuid_mod.UUID(self.user_id))
        self.session.add(
            ApiConfig(
                user_id=user.id,
                api_key_cipher=encrypt("sk-test-key-xxxxxxxx"),
                model_type="gpt-test",
                base_url="https://example.com/v1/chat/completions",
                is_verified=True,
            )
        )
        self.session.add(
            UserDocument(
                user_id=user.id,
                doc_id="doc-gaoshu",
                filename="高数笔记.txt",
                file_type="txt",
                chunk_index=0,
                content="导数定义：函数在一点的变化率。",
            )
        )
        self.session.commit()

        @asynccontextmanager
        async def fake_factory(_credential, _payload):
            async def _chunks():
                yield "根据笔记"

            yield _chunks()

        app.dependency_overrides[get_assistant_stream_factory] = lambda: fake_factory
        response = self.client.post(
            "/api/assistant/chat",
            json={"message": "导数是什么", "context": {"type": "free"}},
        )
        events = _parse_sse(response.text)
        done = [data for event, data in events if event == "done"]
        self.assertEqual(done[-1]["citations"][0]["filename"], "高数笔记.txt")
        self.assertIn("导数定义", done[-1]["citations"][0]["snippet"])


if __name__ == "__main__":
    unittest.main()
