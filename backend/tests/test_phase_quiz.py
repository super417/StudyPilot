"""Batch 16: phase quiz generation."""

from __future__ import annotations

import base64
import os
import unittest
import uuid
from datetime import timedelta

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.clock import local_today
from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import (
    ApiConfig,
    DailyTask,
    Phase,
    Plan,
    PracticeQuestion,
    User,
    UserDocument,
)
from app.services import practice_service
from app.services.practice_service import PracticeNotFoundError, PracticeValidationError


class PhaseQuizTests(unittest.IsolatedAsyncioTestCase):
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
        self.user = User(username=f"quiz-{os.urandom(6).hex()}", password_hash="x" * 20)
        self.session.add(self.user)
        self.session.flush()
        self.session.add(
            ApiConfig(
                user_id=self.user.id,
                api_key_cipher="cipher",
                model_type="gpt",
                base_url="https://example.com",
                is_verified=True,
            )
        )
        self.session.commit()
        self.today = local_today()

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _plan_phase(self) -> tuple[Plan, Phase]:
        plan = Plan(
            user_id=self.user.id,
            goal_name="测验计划",
            start_date=self.today - timedelta(days=5),
            goal_date=self.today + timedelta(days=30),
            current_level="入门",
            daily_minutes=60,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        phase = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="阶段测验",
            start_date=self.today - timedelta(days=5),
            end_date=self.today + timedelta(days=5),
            is_current=True,
        )
        self.session.add(phase)
        self.session.flush()
        return plan, phase

    def _chunk(self, text: str = "阶段测验原文内容足够检索") -> None:
        self.session.add(
            UserDocument(
                user_id=self.user.id,
                doc_id="notes",
                filename="笔记.txt",
                file_type="txt",
                chunk_index=0,
                content=text,
            )
        )
        self.session.commit()

    async def test_no_done_tasks_raises_and_writes_nothing(self) -> None:
        _, phase = self._plan_phase()
        self.session.commit()
        before = self.session.scalar(select(func.count()).select_from(PracticeQuestion)) or 0
        with self.assertRaises(PracticeValidationError):
            await practice_service.generate_phase_quiz(
                self.session, self.user.id, phase.id, lambda lines, ctx: {"questions": []}
            )
        after = self.session.scalar(select(func.count()).select_from(PracticeQuestion)) or 0
        self.assertEqual(before, after)

    async def test_phase_quiz_links_source_task_and_mastery_phase(self) -> None:
        plan, phase = self._plan_phase()
        done = DailyTask(
            plan_id=plan.id,
            phase_id=phase.id,
            task_date=self.today,
            week_label="W01",
            description="已完成的阶段任务",
            status="done",
        )
        self.session.add(done)
        self.session.commit()
        self._chunk("已完成的阶段任务 关键概念")

        def generator(lines, context):
            return {
                "questions": [
                    {
                        "subject": "综合",
                        "question": "阶段测验题",
                        "answer": "答",
                        "explanation": "",
                    }
                ]
            }

        rows = await practice_service.generate_phase_quiz(
            self.session, self.user.id, phase.id, generator
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].source_task_id, done.id)

        evidence = await practice_service.grade_answer(
            self.session,
            self.user.id,
            rows[0].id,
            "我的回答",
            grader=lambda *_a, **_k: {
                "result": "correct",
                "reason": "对",
                "error_tag": None,
            },
        )
        self.assertEqual(evidence.knowledge_point, phase.id)

    async def test_foreign_phase_not_found(self) -> None:
        other = User(username=f"other-{os.urandom(4).hex()}", password_hash="x" * 20)
        self.session.add(other)
        self.session.flush()
        plan = Plan(
            user_id=other.id,
            goal_name="别人的",
            start_date=self.today,
            goal_date=self.today + timedelta(days=10),
            current_level="x",
            daily_minutes=30,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        phase = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="他人阶段",
            start_date=self.today,
            end_date=self.today,
            is_current=True,
        )
        self.session.add(phase)
        self.session.commit()
        with self.assertRaises(PracticeNotFoundError):
            await practice_service.generate_phase_quiz(
                self.session, self.user.id, phase.id, lambda lines, ctx: {"questions": []}
            )


if __name__ == "__main__":
    unittest.main()
