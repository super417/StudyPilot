"""Batch 28: the adjustment preview sends this week's mastery as a soft note.

The note is built from ``weekly_review_service.phase_mastery`` for the current
plan only, rides as its own ``role="user"`` message, and disappears entirely
when there is no evidence — the request then stays byte-identical.
"""

from __future__ import annotations

import json
import os
import unittest
import uuid
from datetime import datetime, time, timedelta, timezone
from unittest.mock import patch

import httpx
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.clock import local_today
from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import (
    ApiConfig,
    DailyTask,
    MasteryEvidence,
    Phase,
    Plan,
    User,
)
from app.services import adjustment_service, planner_service, weekly_review_service

INSTRUCTION = "后两周强度降一点"


def _model_structure(url: str | None = None) -> dict:
    today = local_today()
    tasks = {
        "task_date": today.isoformat(),
        "week_label": "W01",
        "description": "数学：做完例题 1-6",
        "estimated_minutes": 20,
    }
    if url:
        tasks["resource_url"] = url
    return {
        "phases": [
            {
                "name": f"新阶段{i + 1}",
                "start_date": today.isoformat(),
                "end_date": (today + timedelta(days=2)).isoformat(),
                "daily_tasks": [dict(tasks)],
            }
            for i in range(2)
        ]
    }


def _credential():
    return type(
        "C",
        (),
        {
            "model_type": "gpt",
            "base_url": "https://example.com/v1/chat/completions",
            "api_key": "sk-test",
        },
    )()


class MasteryAdjustmentPreviewTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._environment = {
            name: os.environ.get(name) for name in ("DATABASE_URL", "DB_PASSWORD")
        }
        os.environ["DATABASE_URL"] = "sqlite:///:memory:"
        os.environ["DB_PASSWORD"] = "temporary-test-password"
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
        self.today = local_today()
        self.user = User(username=f"mx-{os.urandom(4).hex()}", password_hash="x" * 20)
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
        self.plan = self._plan(self.user, "主计划")
        self.base_phase = self._phase(self.plan, 1, "基础")
        self.adv_phase = self._phase(self.plan, 2, "进阶")
        self._task(self.plan, self.base_phase, "复述中值定理")
        self._task(self.plan, self.adv_phase, "做强化题")

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    # -- fixtures ---------------------------------------------------------

    def _plan(self, user: User, name: str) -> Plan:
        plan = Plan(
            user_id=user.id,
            goal_name=name,
            start_date=self.today,
            goal_date=self.today + timedelta(days=60),
            current_level="零基础",
            daily_minutes=90,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.commit()
        return plan

    def _phase(self, plan: Plan, index: int, name: str) -> Phase:
        phase = Phase(
            plan_id=plan.id,
            phase_index=index,
            name=name,
            start_date=self.today,
            end_date=self.today + timedelta(days=7),
            is_current=index == 1,
        )
        self.session.add(phase)
        self.session.commit()
        return phase

    def _task(self, plan: Plan, phase: Phase, description: str) -> DailyTask:
        task = DailyTask(
            plan_id=plan.id,
            phase_id=phase.id,
            task_date=self.today,
            week_label="W01",
            description=description,
            status="pending",
            estimated_minutes=20,
        )
        self.session.add(task)
        self.session.commit()
        return task

    def _evidence(
        self,
        phase: Phase,
        result: str,
        *,
        error_tag: str | None = None,
        hour: int = 12,
    ) -> MasteryEvidence:
        # Explicit created_at keeps the ordering and the week window deterministic.
        row = MasteryEvidence(
            user_id=self.user.id,
            knowledge_point=phase.id,
            evidence_type="quiz",
            result=result,
            error_tag=error_tag,
            answer_text="答",
            grade_reason="理由",
            created_at=datetime.combine(
                self.today, time(hour, 0), tzinfo=timezone.utc
            ),
        )
        self.session.add(row)
        self.session.commit()
        return row

    def _fields(self) -> dict[str, object]:
        return {
            "goalName": self.plan.goal_name,
            "goalDate": self.plan.goal_date.isoformat(),
            "currentLevel": self.plan.current_level,
            "dailyMinutes": self.plan.daily_minutes,
            "completionCriterion": self.plan.completion_criterion,
        }

    async def _preview(
        self, structure: dict | None = None
    ) -> tuple[object, list[dict]]:
        """Run the real preview entry with a mocked transport; return the bodies."""
        bodies: list[dict] = []
        payload = structure if structure is not None else _model_structure()

        def handler(request: httpx.Request) -> httpx.Response:
            bodies.append(json.loads(request.content))
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {"message": {"content": json.dumps(payload, ensure_ascii=False)}}
                    ]
                },
            )

        transport = httpx.MockTransport(handler)
        real_client = httpx.AsyncClient

        def client_factory(*args, **kwargs):
            kwargs = dict(kwargs)
            kwargs["transport"] = transport
            return real_client(*args, **kwargs)

        with patch(
            "app.services.planner_service.httpx.AsyncClient",
            side_effect=client_factory,
        ), patch(
            "app.services.planner_service.resolve_credential",
            return_value=_credential(),
        ), patch(
            "app.services.planner_service.build_outbound_headers",
            return_value={"Authorization": "Bearer sk-test"},
        ):
            preview = await adjustment_service.create_preview(
                self.session,
                self.user.id,
                self.plan.id,
                INSTRUCTION,
                None,
                [],
                None,
            )
        return preview, bodies

    def _note(self, body: dict) -> str | None:
        messages = body["messages"]
        if len(messages) < 3:
            return None
        return messages[-1]["content"]

    # -- the note ---------------------------------------------------------

    async def test_note_lists_only_evidenced_phases_of_this_plan(self) -> None:
        self._evidence(self.base_phase, "partial", error_tag="概念")
        other_plan = self._plan(self.user, "另一个计划")
        other_phase = self._phase(other_plan, 1, "别的阶段")
        self._evidence(other_phase, "wrong", error_tag="计算")

        _, bodies = await self._preview()
        note = self._note(bodies[0])
        self.assertIsNotNone(note)
        assert note is not None

        week_start, week_end = weekly_review_service.week_bounds(self.today)
        _, detail = weekly_review_service.phase_mastery(
            self.session, self.user.id, week_start, week_end
        )
        base = next(item for item in detail if item["phaseId"] == str(self.base_phase.id))

        self.assertIn("阶段「基础」", note)
        self.assertIn(f"掌握度 {base['percent']}%", note)
        self.assertIn(f"证据 {base['evidenceCount']} 条", note)
        # Phase without evidence, and another plan's phase, stay out.
        self.assertNotIn("进阶", note)
        self.assertNotIn("别的阶段", note)
        self.assertNotIn("0%", note.replace("50%", ""))
        self.assertNotIn("视频", note)
        # Its own message, after the system + request pair.
        self.assertEqual(bodies[0]["messages"][-1]["role"], "user")

    async def test_no_evidence_keeps_the_request_byte_identical(self) -> None:
        _, bodies = await self._preview()
        messages = bodies[0]["messages"]
        self.assertEqual(len(messages), 2)
        self.assertEqual(
            messages[0], {"role": "system", "content": planner_service._PLAN_SYSTEM_PROMPT}
        )
        self.assertEqual(
            messages[1]["content"],
            planner_service._build_plan_user_prompt(
                self._fields(), [], "", INSTRUCTION
            ),
        )

        # Same plan and instruction, now with evidence: only one message is added.
        self._evidence(self.base_phase, "partial", error_tag="概念")
        _, bodies_after = await self._preview()
        messages_after = bodies_after[0]["messages"]
        self.assertEqual(len(messages_after), len(messages) + 1)
        self.assertEqual(messages_after[0], messages[0])
        self.assertEqual(messages_after[1], messages[1])

    async def test_latest_error_tag_comes_from_real_evidence(self) -> None:
        self._evidence(self.base_phase, "partial", error_tag="概念", hour=12)
        self._evidence(self.base_phase, "wrong", error_tag="计算", hour=13)
        # A phase with only correct answers has evidence but no error tag.
        self._evidence(self.adv_phase, "correct", error_tag=None, hour=14)

        _, bodies = await self._preview()
        note = self._note(bodies[0])
        assert note is not None
        lines = note.splitlines()
        base_line = next(line for line in lines if "阶段「基础」" in line)
        adv_line = next(line for line in lines if "阶段「进阶」" in line)

        self.assertIn("最近错误标签：计算", base_line)
        self.assertNotIn("概念", base_line)
        self.assertNotIn("最近错误标签", adv_line)
        self.assertIn("掌握度 100%", adv_line)

    async def test_preview_does_not_touch_mastery_evidence(self) -> None:
        self._evidence(self.base_phase, "partial", error_tag="概念")
        self._evidence(self.base_phase, "wrong", error_tag="计算", hour=13)
        before = [
            (row.id, row.result, row.error_tag, row.knowledge_point)
            for row in self.session.scalars(
                select(MasteryEvidence).order_by(MasteryEvidence.created_at)
            )
        ]

        await self._preview()

        after = [
            (row.id, row.result, row.error_tag, row.knowledge_point)
            for row in self.session.scalars(
                select(MasteryEvidence).order_by(MasteryEvidence.created_at)
            )
        ]
        self.assertEqual(after, before)

    async def test_note_does_not_supply_missing_course_title_evidence(self) -> None:
        self._evidence(self.base_phase, "partial", error_tag="概念")
        allowed = "https://www.bilibili.com/video/BV1xx411c7mD"
        structure = _model_structure(allowed)
        for phase in structure["phases"]:
            phase["daily_tasks"][0]["description"] = "外星晶体量子魔法"
        preview, bodies = await self._preview(structure)
        kept = preview.proposal["phases"][0]["daily_tasks"][0]["resource_url"]
        self.assertIsNone(kept)  # A model URL alone is not title/outline evidence.
        note = self._note(bodies[0])
        assert note is not None
        self.assertNotIn("bilibili", note)

        preview_off, _ = await self._preview(
            {**structure, "phases": [{**phase, "daily_tasks": [{**phase["daily_tasks"][0], "resource_url": "https://example.com/not-allowed"}]} for phase in structure["phases"]]}
        )
        dropped = preview_off.proposal["phases"][0]["daily_tasks"][0]["resource_url"]
        self.assertIsNone(dropped)
