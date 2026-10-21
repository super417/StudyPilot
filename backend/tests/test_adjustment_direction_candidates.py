"""Batch 25: the adjustment preview reuses the plan's saved direction.

The preview asks the same retriever as generation, scoped by
``plan.direction_id`` only — ``overrides`` cannot re-target it. The shortlist is
advice: a link outside it still survives as long as the host check passes, and
the preview never writes course labels.
"""

from __future__ import annotations

import base64
import json
import os
import unittest
from datetime import timedelta
from unittest.mock import patch

import httpx
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.clock import local_today
from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import ApiConfig, DailyTask, Phase, Plan, User
from app.services import adjustment_service, direction_service, planner_service

DIRECTION = "adj-scope"
OTHER_DIRECTION = "other-scope"
BILIBILI = "https://www.bilibili.com/video/BV1xx411c7mD"
SQL_URL = "https://www.icourse163.org/course/c-sql"
GOAL = {
    "goalName": "Python 与 Excel 办公自动化",
    "currentLevel": "零基础",
    "completionCriterion": "能写脚本并做出透视表",
}


def _course(course_id: str, name: str, skill: str, chapter: str, sections: list[str]) -> dict:
    return {
        "course_id": course_id,
        "name": name,
        "institution": "机构",
        "provider": "平台",
        "url": f"https://www.icourse163.org/course/{course_id}",
        "url_verified": True,
        "skills": [skill],
        "chapters": [{"index": 1, "title": chapter, "sections": sections}],
    }


def scope_courses() -> dict:
    return {
        "directions": [
            {
                "id": DIRECTION,
                "name": "调整方向演示",
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
            }
        ]
    }


def structure(*, url: str | None = None) -> dict:
    today = local_today()
    phases = []
    for index in range(2):
        phases.append(
            {
                "name": f"新阶段{index + 1}",
                "start_date": today.isoformat(),
                "end_date": (today + timedelta(days=2)).isoformat(),
                "daily_tasks": [
                    {
                        "task_date": (today + timedelta(days=offset)).isoformat(),
                        "week_label": "W01",
                        "description": f"新安排P{index + 1}D{offset}",
                        "estimated_minutes": 20,
                        **(
                            {"resource_url": url}
                            if url is not None and index == 0 and offset == 0
                            else {}
                        ),
                    }
                    for offset in range(3)
                ],
            }
        )
    return {"phases": phases}


def preview_fields(plan: Plan) -> dict:
    """The five goal fields the preview feeds the prompt (no direction)."""
    return {
        "goalName": plan.goal_name,
        "goalDate": plan.goal_date.isoformat(),
        "currentLevel": plan.current_level,
        "dailyMinutes": plan.daily_minutes,
        "completionCriterion": plan.completion_criterion,
    }


class _PreviewCase(unittest.IsolatedAsyncioTestCase):
    direction_id: str | None = DIRECTION

    @classmethod
    def setUpClass(cls) -> None:
        cls._environment = {
            name: os.environ.get(name)
            for name in ("DATABASE_URL", "DB_PASSWORD", "AES_KEY", "SESSION_TIMEOUT_MINUTES")
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
        self.user = User(username=f"adj25-{os.urandom(6).hex()}", password_hash="x" * 20)
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
        self.today = local_today()
        self.plan = Plan(
            user_id=self.user.id,
            goal_name=GOAL["goalName"],
            start_date=self.today - timedelta(days=5),
            goal_date=self.today + timedelta(days=90),
            current_level=GOAL["currentLevel"],
            daily_minutes=90,
            completion_criterion=GOAL["completionCriterion"],
            total_phases=2,
            direction_id=self.direction_id,
        )
        self.session.add(self.plan)
        self.session.flush()
        self.phase = Phase(
            plan_id=self.plan.id,
            phase_index=1,
            name="基础",
            start_date=self.today - timedelta(days=5),
            end_date=self.today + timedelta(days=10),
            is_current=True,
        )
        self.session.add(self.phase)
        self.session.flush()
        self.protected = DailyTask(
            plan_id=self.plan.id,
            phase_id=self.phase.id,
            task_date=self.today - timedelta(days=2),
            week_label="W01",
            description="过去保留",
            status="pending",
            resource_url=BILIBILI,
            chapter_title="第1章 Python 基础",
            section_title="变量与循环",
        )
        self.done = DailyTask(
            plan_id=self.plan.id,
            phase_id=self.phase.id,
            task_date=self.today,
            week_label="W01",
            description="已完成保留",
            status="done",
            estimated_minutes=20,
        )
        self.pending = DailyTask(
            plan_id=self.plan.id,
            phase_id=self.phase.id,
            task_date=self.today + timedelta(days=3),
            week_label="W01",
            description="将来可替换",
            status="pending",
            resource_url=SQL_URL,
            chapter_title="第1章 SQL 查询",
            section_title="联结与聚合",
        )
        self.session.add_all([self.protected, self.done, self.pending])
        self.session.commit()
        self.courses_patch = patch(
            "app.services.direction_service.load_courses", return_value=scope_courses()
        )
        self.courses_patch.start()

    def tearDown(self) -> None:
        self.courses_patch.stop()
        self.session.close()
        Base.metadata.drop_all(self.engine)

    # --- helpers -----------------------------------------------------------

    def candidates(self) -> list[dict]:
        return planner_service._target_course_candidates(
            {**preview_fields(self.plan), "directionId": self.plan.direction_id}
            if self.plan.direction_id
            else preview_fields(self.plan)
        )

    def capture_model(self, payload_structure: dict | None = None) -> dict:
        """Patch the outbound HTTP call and keep the real request payload."""
        captured: dict = {}
        real_client = httpx.AsyncClient
        body = payload_structure if payload_structure is not None else structure()

        def handler(request: httpx.Request) -> httpx.Response:
            captured["payload"] = json.loads(request.content.decode("utf-8"))
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {"message": {"content": json.dumps(body, ensure_ascii=False)}}
                    ]
                },
            )

        def factory(*args, **kwargs):
            kwargs = dict(kwargs)
            kwargs["transport"] = httpx.MockTransport(handler)
            return real_client(*args, **kwargs)

        patches = [
            patch("app.services.planner_service.httpx.AsyncClient", side_effect=factory),
            patch(
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
            ),
            patch(
                "app.services.planner_service.build_outbound_headers",
                return_value={"Authorization": "Bearer sk-test"},
            ),
        ]
        self._active_patches = patches
        for item in patches:
            item.start()
        return captured

    def stop_capture(self) -> None:
        for item in getattr(self, "_active_patches", []):
            item.stop()
        self._active_patches = []

    async def preview(self, *, instruction: str = "压缩第二阶段", overrides=None, generator=None):
        return await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            instruction,
            overrides,
            [],
            generator,
        )

    def task_by_description(self, description: str) -> DailyTask | None:
        self.session.expire_all()
        return self.session.scalar(
            select(DailyTask).where(
                DailyTask.plan_id == self.plan.id,
                DailyTask.description == description,
            )
        )


class DirectionCandidateMessageTests(_PreviewCase):
    """1/2/3: what the model actually receives."""

    def _baseline_messages(self, instruction: str) -> list[dict]:
        prompt = planner_service._build_plan_user_prompt(
            preview_fields(self.plan), [], "", instruction
        )
        return [
            {"role": "system", "content": planner_service._PLAN_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]

    async def test_saved_direction_adds_soft_candidate_message(self) -> None:
        self.assertTrue(self.candidates())
        captured = self.capture_model()
        try:
            await self.preview()
        finally:
            self.stop_capture()

        messages = captured["payload"]["messages"]
        self.assertEqual(len(messages), 3)
        self.assertEqual(messages[0]["content"], planner_service._PLAN_SYSTEM_PROMPT_SOFT)
        self.assertIn("优先从该消息给出的 url 中选择", messages[0]["content"])
        self.assertNotIn("只能从该消息给出的 url 中原样选择", messages[0]["content"])
        self.assertNotIn("平台课程库候选", messages[1]["content"])

        catalog = messages[2]["content"]
        self.assertIn("平台课程库候选", catalog)
        self.assertIn("可参考下列课程", catalog)
        self.assertIn("优先从中选择，不要自造链接", catalog)
        self.assertNotIn("必须从下列 url 中原样复制", catalog)
        for item in self.candidates():
            self.assertIn(item["url"], catalog)
            self.assertIn(item["courseId"], catalog)

    async def test_no_direction_messages_are_byte_identical(self) -> None:
        self.plan.direction_id = None
        self.session.commit()
        captured = self.capture_model()
        try:
            await self.preview(instruction="压缩第二阶段")
        finally:
            self.stop_capture()

        messages = captured["payload"]["messages"]
        self.assertEqual(messages, self._baseline_messages("压缩第二阶段"))
        self.assertEqual(len(messages), 2)
        self.assertNotIn("平台课程库候选", messages[1]["content"])

    async def test_unknown_direction_id_falls_back_to_no_candidate(self) -> None:
        self.plan.direction_id = "no-such-direction"
        self.session.commit()
        self.assertEqual(self.candidates(), [])
        captured = self.capture_model()
        try:
            preview = await self.preview(instruction="压缩第二阶段")
        finally:
            self.stop_capture()

        self.assertEqual(preview.status, "pending")
        messages = captured["payload"]["messages"]
        self.assertEqual(messages, self._baseline_messages("压缩第二阶段"))
        self.assertEqual(messages[0]["content"], planner_service._PLAN_SYSTEM_PROMPT)

    async def test_generation_wording_stays_strict(self) -> None:
        """The preview variant must not leak into the generation path."""
        candidates = self.candidates()
        self.assertTrue(candidates)
        strict_catalog = planner_service._course_catalog_message(candidates)
        self.assertIn("必须从下列 url 中原样复制", strict_catalog)
        self.assertIn("只能从该消息给出的 url 中原样选择", planner_service._PLAN_SYSTEM_PROMPT)
        soft_catalog = planner_service._course_catalog_message(candidates, soft=True)
        self.assertEqual(
            strict_catalog.splitlines()[1:], soft_catalog.splitlines()[1:]
        )
        self.assertNotEqual(strict_catalog.splitlines()[0], soft_catalog.splitlines()[0])

    async def test_overrides_cannot_retarget_the_direction(self) -> None:
        captured = self.capture_model()
        try:
            preview = await self.preview(overrides={"directionId": OTHER_DIRECTION})
        finally:
            self.stop_capture()

        self.assertEqual(preview.proposal["fields"]["directionId"], DIRECTION)
        messages = captured["payload"]["messages"]
        self.assertEqual(len(messages), 3)
        self.assertNotIn(OTHER_DIRECTION, json.dumps(captured["payload"], ensure_ascii=False))
        for item in self.candidates():
            self.assertIn(item["url"], messages[2]["content"])


class PreviewUrlAndLabelTests(_PreviewCase):
    """4/5/6/7: URLs, direction persistence, and course labels."""

    async def test_non_candidate_allow_listed_url_survives_preview_and_confirm(self) -> None:
        offered = {item["url"] for item in self.candidates()}
        self.assertNotIn(BILIBILI, offered)

        def generator(fields, used_docs, context_text, instruction):
            return structure(url=BILIBILI)

        preview = await self.preview(generator=generator)
        self.assertEqual(
            preview.proposal["phases"][0]["daily_tasks"][0]["resource_url"], BILIBILI
        )
        adjustment_service.confirm_adjustment(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            expected_selection_version=preview.proposal["selectionVersion"],
        )
        task = self.task_by_description("新安排P1D0")
        self.assertIsNotNone(task)
        self.assertEqual(task.resource_url, BILIBILI)

    async def test_direction_id_is_unchanged_by_preview_and_confirm(self) -> None:
        def generator(fields, used_docs, context_text, instruction):
            return structure()

        preview = await self.preview(generator=generator, overrides={"directionId": OTHER_DIRECTION})
        self.session.expire_all()
        self.assertEqual(self.session.get(Plan, self.plan.id).direction_id, DIRECTION)

        adjustment_service.confirm_adjustment(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            expected_selection_version=preview.proposal["selectionVersion"],
        )
        self.session.expire_all()
        self.assertEqual(self.session.get(Plan, self.plan.id).direction_id, DIRECTION)

    async def test_protected_tasks_keep_url_and_course_labels(self) -> None:
        before = (
            self.protected.resource_url,
            self.protected.chapter_title,
            self.protected.section_title,
        )

        def generator(fields, used_docs, context_text, instruction):
            return structure(url=SQL_URL)

        preview = await self.preview(generator=generator)
        adjustment_service.confirm_adjustment(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            expected_selection_version=preview.proposal["selectionVersion"],
        )
        self.session.expire_all()
        kept = self.session.get(DailyTask, self.protected.id)
        self.assertIsNotNone(kept)
        self.assertEqual(
            (kept.resource_url, kept.chapter_title, kept.section_title), before
        )
        self.assertEqual(kept.description, "过去保留")

    async def test_rewritten_tasks_get_no_course_labels(self) -> None:
        offered = self.candidates()
        self.assertTrue(offered)
        course_url = offered[0]["url"]

        def generator(fields, used_docs, context_text, instruction):
            return structure(url=course_url)

        preview = await self.preview(generator=generator)
        adjustment_service.confirm_adjustment(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            expected_selection_version=preview.proposal["selectionVersion"],
        )
        self.assertIsNone(self.task_by_description("将来可替换"))
        rewritten = self.task_by_description("新安排P1D0")
        self.assertIsNotNone(rewritten)
        self.assertEqual(rewritten.resource_url, course_url)
        self.assertIsNone(rewritten.chapter_title)
        self.assertIsNone(rewritten.section_title)
        for task in self.session.scalars(
            select(DailyTask).where(DailyTask.plan_id == self.plan.id)
        ):
            if task.description.startswith("新安排"):
                self.assertIsNone(task.chapter_title)
                self.assertIsNone(task.section_title)
