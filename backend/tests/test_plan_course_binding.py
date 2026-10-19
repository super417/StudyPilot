"""Batch 15b: plan generation anchors resource_url to verified course catalog."""

from __future__ import annotations

import base64
import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import ApiConfig, DailyTask, User
from app.services import direction_service, planner_service
from app.services.planner_service import generate_plan


def _today():
    return datetime.now(timezone.utc).date()


def _goal(*, direction_id: str | None = None) -> dict:
    payload = {
        "goalName": "AI+财务数据分析入门",
        "goalDate": (_today() + timedelta(days=400)).isoformat(),
        "currentLevel": "会一点 Excel",
        "dailyMinutes": 90,
        "completionCriterion": "能独立完成一份财务数据清洗练习",
    }
    if direction_id is not None:
        payload["directionId"] = direction_id
    return payload


def _two_phase_structure(tasks: list[dict]) -> dict:
    today = _today()
    first = today.isoformat()
    second = (today + timedelta(days=1)).isoformat()
    while len(tasks) < 2:
        tasks.append(
            {
                "task_date": second if len(tasks) else first,
                "week_label": "W01",
                "description": f"占位任务 {len(tasks)+1}",
            }
        )
    return {
        "phases": [
            {
                "name": "阶段 1",
                "start_date": first,
                "end_date": second,
                "daily_tasks": [dict(tasks[0]), dict(tasks[1])],
            },
            {
                "name": "阶段 2",
                "start_date": first,
                "end_date": second,
                "daily_tasks": [
                    {
                        "task_date": first,
                        "week_label": "W01",
                        "description": "阶段2复习",
                    },
                    {
                        "task_date": second,
                        "week_label": "W01",
                        "description": "阶段2练习",
                    },
                ],
            },
        ]
    }


def _unverified_only_courses() -> dict:
    return {
        "directions": [
            {
                "id": "unverified-only",
                "name": "仅未核实课程",
                "description": "用于空候选验收",
                "skills": ["Python"],
                "courses": [
                    {
                        "course_id": "uv-1",
                        "name": "未核实课",
                        "institution": "机构",
                        "provider": "平台",
                        "url": "https://www.icourse163.org/course/UV-1",
                        "url_verified": False,
                        "skills": ["Python"],
                        "collected_at": "2026-10-13",
                        "chapters": [],
                    },
                    {
                        "course_id": "uv-empty",
                        "name": "空链接课",
                        "institution": "机构",
                        "provider": "平台",
                        "url": "",
                        "url_verified": True,
                        "skills": ["Python"],
                        "collected_at": "2026-10-13",
                        "chapters": [],
                    },
                ],
            }
        ]
    }


class VerifiedCourseCandidateFilterTests(unittest.TestCase):
    def test_verified_course_candidates_skips_unverified_and_empty_url(self) -> None:
        courses = {
            "directions": [
                {
                    "id": "demo",
                    "name": "演示",
                    "description": "",
                    "skills": [],
                    "courses": [
                        {
                            "course_id": "ok",
                            "name": "已核实",
                            "url": "https://www.icourse163.org/course/OK",
                            "url_verified": True,
                        },
                        {
                            "course_id": "bad",
                            "name": "未核实",
                            "url": "https://www.icourse163.org/course/BAD",
                            "url_verified": False,
                        },
                        {
                            "course_id": "empty",
                            "name": "空 url",
                            "url": "",
                            "url_verified": True,
                        },
                        {
                            "course_id": "blank",
                            "name": "空白 url",
                            "url": "   ",
                            "url_verified": True,
                        },
                    ],
                }
            ]
        }
        got = direction_service.verified_course_candidates(
            "demo", courses_data=courses
        )
        self.assertEqual([item["courseId"] for item in got], ["ok"])
        self.assertEqual(got[0]["url"], "https://www.icourse163.org/course/OK")


class PlanCourseBindingTests(unittest.IsolatedAsyncioTestCase):
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
        self.user = User(username=f"bind-{os.urandom(6).hex()}", password_hash="x" * 20)
        self.session.add(self.user)
        self.session.flush()
        self.session.add(
            ApiConfig(
                user_id=self.user.id,
                api_key_cipher="cipher",
                model_type="gpt",
                base_url="https://example.com/v1/chat/completions",
                is_verified=True,
            )
        )
        self.session.commit()
        self.candidates = direction_service.verified_course_candidates("ai-finance")
        self.assertTrue(self.candidates, "fixture expects ai-finance courses")
        self.course_url = self.candidates[0]["url"]
        self.allowed = frozenset(item["url"] for item in self.candidates)

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    async def test_anchors_resource_url_to_course_catalog(self) -> None:
        today = _today().isoformat()
        tomorrow = (_today() + timedelta(days=1)).isoformat()

        def generator(fields, used_docs, context_text, instruction):
            return _two_phase_structure(
                [
                    {
                        "task_date": today,
                        "week_label": "W01",
                        "description": "学财务 Python 基础",
                        "resource_url": self.course_url,
                    },
                    {
                        "task_date": tomorrow,
                        "week_label": "W01",
                        "description": "练习数据清洗",
                        "resource_url": "https://www.bilibili.com",
                    },
                ]
            )

        await generate_plan(
            self.session, self.user.id, _goal(direction_id="ai-finance"), [], generator
        )
        tasks = list(self.session.scalars(select(DailyTask)))
        urls = [task.resource_url for task in tasks if task.resource_url]
        self.assertIn(self.course_url, urls)
        for url in urls:
            self.assertIn(url, self.allowed)

    async def test_invented_url_dropped_task_kept(self) -> None:
        today = _today().isoformat()
        tomorrow = (_today() + timedelta(days=1)).isoformat()
        fake = "https://fake.example/course"

        def generator(fields, used_docs, context_text, instruction):
            return _two_phase_structure(
                [
                    {
                        "task_date": today,
                        "week_label": "W01",
                        "description": "自造链接任务",
                        "resource_url": fake,
                    },
                    {
                        "task_date": tomorrow,
                        "week_label": "W01",
                        "description": "普通任务",
                    },
                ]
            )

        await generate_plan(
            self.session, self.user.id, _goal(direction_id="ai-finance"), [], generator
        )
        tasks = list(self.session.scalars(select(DailyTask)))
        by_desc = {task.description: task for task in tasks}
        self.assertIn("自造链接任务", by_desc)
        self.assertIsNone(by_desc["自造链接任务"].resource_url)
        self.assertNotIn(fake, [task.resource_url for task in tasks])

    async def test_direction_with_empty_candidates_still_generates_without_links(
        self,
    ) -> None:
        """方向存在但无 url_verified 候选：照常生成，链接全部丢弃（含平台首页）。"""
        today = _today().isoformat()
        tomorrow = (_today() + timedelta(days=1)).isoformat()

        def generator(fields, used_docs, context_text, instruction):
            return _two_phase_structure(
                [
                    {
                        "task_date": today,
                        "week_label": "W01",
                        "description": "空候选方向任务A",
                        "resource_url": "https://www.bilibili.com",
                    },
                    {
                        "task_date": tomorrow,
                        "week_label": "W01",
                        "description": "空候选方向任务B",
                        "resource_url": "https://www.icourse163.org",
                    },
                ]
            )

        with patch(
            "app.services.direction_service.load_courses",
            return_value=_unverified_only_courses(),
        ):
            result = await generate_plan(
                self.session,
                self.user.id,
                _goal(direction_id="unverified-only"),
                [],
                generator,
            )
        self.assertEqual(result.phases, 2)
        tasks = list(self.session.scalars(select(DailyTask)))
        self.assertTrue(tasks)
        self.assertTrue(all(task.resource_url is None for task in tasks))

    async def test_course_catalog_is_separate_user_message(self) -> None:
        """课程候选不得拼进 goal/检索那条 user 消息（§4.1）。"""
        captured: dict = {}
        structure = _two_phase_structure([])
        real_async_client = httpx.AsyncClient

        def handler(request: httpx.Request) -> httpx.Response:
            captured["payload"] = json.loads(request.content.decode("utf-8"))
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {"message": {"content": json.dumps(structure, ensure_ascii=False)}}
                    ]
                },
            )

        transport = httpx.MockTransport(handler)

        def client_factory(*args, **kwargs):
            kwargs = dict(kwargs)
            kwargs["transport"] = transport
            return real_async_client(*args, **kwargs)

        with patch(
            "app.services.planner_service.httpx.AsyncClient",
            side_effect=client_factory,
        ), patch(
            "app.services.planner_service.resolve_credential",
            return_value=type(
                "C",
                (),
                {
                    "model_type": "gpt",
                    "base_url": "https://example.com/v1/chat/completions",
                    "api_key": "sk-test",
                },
            )(),
        ), patch(
            "app.services.planner_service.build_outbound_headers",
            return_value={"Authorization": "Bearer sk-test"},
        ):
            await generate_plan(
                self.session,
                self.user.id,
                _goal(direction_id="ai-finance"),
                [],
                None,
            )

        messages = captured["payload"]["messages"]
        self.assertEqual(len(messages), 3)
        self.assertEqual(messages[0]["role"], "system")
        self.assertEqual(messages[1]["role"], "user")
        self.assertEqual(messages[2]["role"], "user")
        self.assertIn("平台课程库候选", messages[2]["content"])
        self.assertIn(self.course_url, messages[2]["content"])
        for item in self.candidates:
            self.assertNotIn(item["url"], messages[1]["content"])


if __name__ == "__main__":
    unittest.main()
