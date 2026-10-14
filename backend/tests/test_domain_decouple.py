"""Zhihang batch 1: domain decoupling regressions.

Product prompts and the heuristic fallback must not lock the product to the
kaoyan domain. Entertainment off-topic refusal stays; only the learning domain
wording changes.
"""

from __future__ import annotations

import base64
import json
import os
import unittest
import uuid
from contextlib import asynccontextmanager
from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import encrypt, get_cipher
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.entities import ApiConfig, User
from app.routers.assistant import get_assistant_stream_factory
from app.services import assistant_service, planner_service
from app.services.session_service import session_store

_KAOYAN_DOMAIN_WORDS = ("考研", "复试", "政治", "专业课")


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


class DomainPromptTests(unittest.TestCase):
    def test_assistant_prompt_and_refusal_drop_kaoyan_domain_words(self) -> None:
        for word in _KAOYAN_DOMAIN_WORDS:
            self.assertNotIn(word, assistant_service._SYSTEM_PROMPT)
            self.assertNotIn(word, assistant_service._DOMAIN_REFUSAL)

    def test_heuristic_plan_structure_drops_kaoyan_and_stays_valid(self) -> None:
        structure = planner_service._heuristic_plan_structure(
            {
                "goalDate": (date.today() + timedelta(days=120)).isoformat(),
                "currentLevel": "零基础",
            }
        )
        blob = json.dumps(structure, ensure_ascii=False)
        self.assertNotIn("考研", blob)

        phases = planner_service._validate_structure(structure)
        self.assertEqual(len(phases), 2)
        previous_end: date | None = None
        for phase in phases:
            self.assertIsInstance(phase.get("name"), str)
            self.assertTrue(phase["name"].strip())
            start = date.fromisoformat(phase["start_date"])
            end = date.fromisoformat(phase["end_date"])
            self.assertLessEqual(start, end)
            if previous_end is not None:
                self.assertGreater(start, previous_end)
            previous_end = end
            tasks = phase.get("daily_tasks")
            self.assertIsInstance(tasks, list)
            self.assertGreaterEqual(len(tasks), 1)
            for task in tasks:
                self.assertIn("task_date", task)
                self.assertIn("description", task)
                self.assertNotIn("考研", task["description"])
                date.fromisoformat(task["task_date"])


class DomainChatRouteTests(unittest.TestCase):
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
        username = f"zh1-{os.urandom(4).hex()}"
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

    def test_empty_message_validation_is_not_kaoyan_locked(self) -> None:
        response = self.client.post("/api/assistant/chat", json={"message": "   "})
        self.assertEqual(response.status_code, 200)
        events = _parse_sse(response.text)
        self.assertEqual(events[0][0], "error")
        message = events[0][1]["message"]
        self.assertNotIn("考研", message)
        self.assertEqual(events[0][1]["code"], "VALIDATION")

    def test_ai_finance_learning_question_is_not_domain_refused(self) -> None:
        user = self.session.get(User, uuid.UUID(self.user_id))
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
                yield "可以从财务数据清洗与报表指标入门。"

            yield _chunks()

        app.dependency_overrides[get_assistant_stream_factory] = lambda: fake_factory
        response = self.client.post(
            "/api/assistant/chat",
            json={
                "message": "AI 财务数据分析怎么学",
                "context": {"type": "free"},
            },
        )
        self.assertEqual(response.status_code, 200)
        events = _parse_sse(response.text)
        tokens = "".join(
            data.get("delta", "") for event, data in events if event == "token"
        )
        self.assertNotIn("领域拦截", tokens)
        for word in _KAOYAN_DOMAIN_WORDS:
            self.assertNotIn(word, tokens)
        self.assertIn("财务", tokens)
        self.assertTrue(any(event == "done" for event, _ in events))


if __name__ == "__main__":
    unittest.main()
