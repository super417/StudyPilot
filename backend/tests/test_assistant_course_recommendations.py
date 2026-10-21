"""Batch 26: chat recommendations are scoped to the plan's own direction.

The request gains one extra message when the latest user turn asks for
courses. Candidates come from ``direction_service.rank_courses`` on
``plan.direction_id`` only; without a trigger, a plan, or a direction the
request must stay byte-identical to what it was before this batch.
"""

from __future__ import annotations

import base64
import os
import unittest
from contextlib import asynccontextmanager
from datetime import timedelta
from unittest.mock import call, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.clock import local_today
from app.core.config import get_settings
from app.core.crypto import encrypt, get_cipher
from app.models.base import Base
from app.models.entities import ApiConfig, Plan, User
from app.services import assistant_service, direction_service
from app.services.assistant_service import (
    _COURSE_NOTE_RULE,
    build_chat_messages,
    wants_course_recommendations,
)

DIRECTION = "chat-scope"
OTHER_DIRECTION = "chat-other"
QUERY = "推荐 Python 课程"
# Trigger present, but nothing in the fixture can match it.
UNMATCHED_QUERY = "推荐量子力学课程"
NEUTRAL = "高数怎么复习"

PY_URL = "https://www.icourse163.org/course/c-python"
EXCEL_URL = "https://www.icourse163.org/course/c-excel"
SQL_URL = "https://www.icourse163.org/course/c-sql"
OTHER_URL = "https://www.icourse163.org/course/c-secret"
OTHER_NAME = "Python 大师课"


def _course(course_id: str, name: str, skill: str, chapter: str, sections: list[str]) -> dict:
    return {
        "course_id": course_id,
        "name": name,
        "institution": "机构",
        "provider": "平台",
        "url": f"https://www.icourse163.org/course/{course_id}",
        "url_verified": True,
        "skills": [skill],
        "collected_at": "2026-10-21",
        "chapters": [{"index": 1, "title": chapter, "sections": sections}],
    }


def scope_courses() -> dict:
    """Two directions: only the plan's own one may be searched."""
    return {
        "directions": [
            {
                "id": DIRECTION,
                "name": "聊天推荐演示",
                "description": "",
                "skills": ["Python", "Excel", "SQL"],
                "courses": [
                    _course(
                        "c-python",
                        "Python 脚本入门",
                        "Python",
                        "第1章 Python 基础",
                        ["变量与循环", "函数定义"],
                    ),
                    _course(
                        "c-excel",
                        "Excel 透视表实战",
                        "Excel",
                        "第1章 Excel 表格",
                        ["函数与透视", "图表美化"],
                    ),
                    _course(
                        "c-sql",
                        "SQL 查询精讲",
                        "SQL",
                        "第1章 SQL 查询",
                        ["联结与聚合", "子查询嵌套"],
                    ),
                ],
            },
            {
                "id": OTHER_DIRECTION,
                "name": "另一个方向",
                "description": "",
                "skills": ["Python"],
                "courses": [
                    _course(
                        "c-secret",
                        OTHER_NAME,
                        "Python",
                        "第1章 Python 进阶",
                        ["装饰器与生成器"],
                    )
                ],
            },
        ]
    }


class _ChatCase(unittest.IsolatedAsyncioTestCase):
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

    @classmethod
    def tearDownClass(cls) -> None:
        Base.metadata.drop_all(cls.engine)
        cls.engine.dispose()
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
        self.user = User(
            username=f"chat26-{os.urandom(6).hex()}", password_hash="x" * 20
        )
        self.session.add(self.user)
        self.session.flush()
        self.session.add(
            ApiConfig(
                user_id=self.user.id,
                api_key_cipher=encrypt("sk-test-key-xxxxxxxx"),
                model_type="gpt-test",
                base_url="https://example.com/v1/chat/completions",
                is_verified=True,
            )
        )
        today = local_today()
        self.plan = Plan(
            user_id=self.user.id,
            goal_name="Python 与 Excel 办公自动化",
            start_date=today,
            goal_date=today + timedelta(days=90),
            current_level="零基础",
            daily_minutes=90,
            completion_criterion="能写脚本并做出透视表",
            total_phases=2,
            direction_id=DIRECTION,
        )
        self.session.add(self.plan)
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _golden(self, message: str) -> list[dict[str, str]]:
        """The two messages this turn produced before the batch 26 change."""
        return build_chat_messages(
            message,
            context_type=None,
            mistake_excerpt="",
            rag_text="",
        )

    async def _capture(self, message: str) -> dict:
        """Run one model-reply turn and return the payload sent upstream."""
        captured: dict = {}

        @asynccontextmanager
        async def fake_factory(_credential, payload):
            captured["payload"] = payload

            async def _chunks():
                yield "好的"

            yield _chunks()

        frames = []
        async for frame in assistant_service._stream_chat_reply(
            self.session,
            self.user.id,
            message,
            None,
            stream_factory=fake_factory,
        ):
            frames.append(frame)
        self.assertTrue(frames, "turn produced no SSE frame")
        self.assertIn("payload", captured, "the model was never called")
        return captured["payload"]


class CourseTriggerTests(unittest.TestCase):
    def test_each_trigger_word_is_enough(self) -> None:
        for word in ("课程", "网课", "推荐", "学习资料", "资源", "教程", "怎么学"):
            with self.subTest(word=word):
                self.assertTrue(wants_course_recommendations(f"帮我看看{word}"))

    def test_neutral_message_does_not_trigger(self) -> None:
        self.assertFalse(wants_course_recommendations(NEUTRAL))
        self.assertFalse(wants_course_recommendations("导数是什么"))
        self.assertFalse(wants_course_recommendations(""))


class CourseCandidatesMessageTests(_ChatCase):
    async def test_trigger_with_direction_adds_one_candidates_message(self) -> None:
        with patch.object(direction_service, "load_courses", scope_courses):
            expected = direction_service.rank_courses(DIRECTION, QUERY)
            self.assertTrue(expected, "fixture produced no ranking")
            with patch.object(
                direction_service, "rank_courses", wraps=direction_service.rank_courses
            ) as spy:
                payload = await self._capture(QUERY)
            rank_calls = spy.call_args_list

        messages = payload["messages"]
        self.assertEqual([item["role"] for item in messages], ["system", "user", "user"])
        self.assertEqual(messages[:2], self._golden(QUERY))

        note = messages[2]["content"]
        self.assertIn(_COURSE_NOTE_RULE, note)
        for item in expected:
            with self.subTest(course=item["courseId"]):
                self.assertIn(f"course_id={item['courseId']}", note)
                self.assertIn(f"课程名={item['name']}", note)
                self.assertIn(f"url={item['url']}", note)
                self.assertIn(
                    f"章节={item['chapterTitle']} · {item['sectionTitle']}", note
                )
        self.assertIn(PY_URL, note)
        self.assertNotIn(OTHER_URL, note)
        self.assertNotIn(OTHER_NAME, note)
        self.assertEqual(rank_calls, [call(DIRECTION, QUERY)])

    async def test_no_trigger_keeps_messages_verbatim_and_skips_retrieval(self) -> None:
        with patch.object(
            direction_service,
            "rank_courses",
            side_effect=AssertionError("course retrieval must not run"),
        ):
            payload = await self._capture(NEUTRAL)
        self.assertEqual(payload["messages"], self._golden(NEUTRAL))

    async def test_trigger_without_plan_keeps_messages_verbatim(self) -> None:
        self.session.delete(self.plan)
        self.session.commit()
        with patch.object(
            direction_service,
            "rank_courses",
            side_effect=AssertionError("course retrieval must not run"),
        ):
            payload = await self._capture(QUERY)
        self.assertEqual(payload["messages"], self._golden(QUERY))

    async def test_trigger_with_null_direction_keeps_messages_verbatim(self) -> None:
        self.plan.direction_id = None
        self.session.commit()
        with patch.object(
            direction_service,
            "rank_courses",
            side_effect=AssertionError("course retrieval must not run"),
        ):
            payload = await self._capture(QUERY)
        self.assertEqual(payload["messages"], self._golden(QUERY))

    async def test_empty_ranking_says_no_match_without_candidate_lines(self) -> None:
        with patch.object(direction_service, "load_courses", scope_courses):
            payload = await self._capture(UNMATCHED_QUERY)

        messages = payload["messages"]
        self.assertEqual(messages[:2], self._golden(UNMATCHED_QUERY))
        note = messages[2]["content"]
        self.assertIn("课程库暂无匹配", note)
        self.assertNotIn("course_id=", note)
        self.assertNotIn("视频", note)

    async def test_empty_ranking_never_falls_back_to_the_whole_catalog(self) -> None:
        with patch.object(direction_service, "rank_courses", return_value=[]), patch.object(
            direction_service,
            "verified_course_candidates",
            side_effect=AssertionError("must not read the whole catalogue"),
        ), patch.object(
            direction_service,
            "allowed_course_urls",
            side_effect=AssertionError("must not read the whole catalogue"),
        ):
            payload = await self._capture(QUERY)

        messages = payload["messages"]
        self.assertEqual(messages[:2], self._golden(QUERY))
        note = messages[2]["content"]
        self.assertIn("课程库暂无匹配", note)
        self.assertNotIn("course_id=", note)
        for url in (PY_URL, EXCEL_URL, SQL_URL, OTHER_URL):
            with self.subTest(url=url):
                self.assertNotIn(url, note)

    async def test_candidates_message_never_calls_them_videos(self) -> None:
        with patch.object(direction_service, "load_courses", scope_courses):
            payload = await self._capture(QUERY)
        self.assertNotIn("视频", payload["messages"][2]["content"])


if __name__ == "__main__":
    unittest.main()
