"""Reinforce retest anchoring and before/after mastery split."""

from __future__ import annotations

import asyncio
import base64
import os
import unittest
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import (
    ApiConfig,
    DailyTask,
    MasteryEvidence,
    Phase,
    Plan,
    PracticeQuestion,
    ReinforceTaskEvidence,
    User,
    UserDocument,
)
from app.services import practice_service, reinforce_service
from app.services.practice_service import PracticeValidationError


class ReinforceRetestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._environment = {
            name: os.environ.get(name)
            for name in ("DATABASE_URL", "DB_PASSWORD", "AES_KEY")
        }
        os.environ["DATABASE_URL"] = "sqlite:///:memory:"
        os.environ["DB_PASSWORD"] = "temporary-test-password"
        os.environ["AES_KEY"] = base64.b64encode(bytes(range(32))).decode("ascii")
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
        self.today = date(2026, 10, 14)

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _user(self) -> User:
        user = User(username=f"retest-{os.urandom(4).hex()}", password_hash="x")
        self.session.add(user)
        self.session.commit()
        return user

    def _verified(self, user: User) -> None:
        self.session.add(
            ApiConfig(
                user_id=user.id,
                api_key_cipher="cipher",
                model_type="gpt",
                base_url="https://example.invalid/v1/chat/completions",
                is_verified=True,
            )
        )
        self.session.commit()

    def _plan_two_phases(self, user: User) -> tuple[Plan, Phase, Phase]:
        plan = Plan(
            user_id=user.id,
            goal_name="重测目标",
            start_date=date(2026, 1, 1),
            goal_date=date(2026, 12, 31),
            current_level="入门",
            daily_minutes=60,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        phase_a = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="阶段A",
            start_date=date(2026, 1, 1),
            end_date=date(2026, 6, 30),
            is_current=True,
        )
        phase_b = Phase(
            plan_id=plan.id,
            phase_index=2,
            name="阶段B",
            start_date=date(2026, 7, 1),
            end_date=date(2026, 12, 31),
            is_current=False,
        )
        self.session.add_all([phase_a, phase_b])
        self.session.commit()
        return plan, phase_a, phase_b

    def _task(
        self, plan: Plan, phase: Phase, description: str, status: str = "done"
    ) -> DailyTask:
        task = DailyTask(
            plan_id=plan.id,
            phase_id=phase.id,
            task_date=self.today,
            week_label="W42",
            description=description,
            status=status,
        )
        self.session.add(task)
        self.session.commit()
        return task

    def _question(
        self, user: User, task: DailyTask | None, text: str = "重测题"
    ) -> PracticeQuestion:
        row = PracticeQuestion(
            user_id=user.id,
            source="generated",
            subject="数学",
            question=text,
            answer="答案",
            explanation="",
            source_task_id=None if task is None else task.id,
            status="pending",
        )
        self.session.add(row)
        self.session.commit()
        return row

    def _evidence(
        self,
        user: User,
        phase: Phase,
        question: PracticeQuestion | None,
        result: str,
        *,
        created: datetime | None = None,
    ) -> MasteryEvidence:
        row = MasteryEvidence(
            user_id=user.id,
            knowledge_point=phase.id,
            evidence_type="quiz",
            result=result,
            answer_text="作答",
            grade_reason="按作答判断",
            source_ref=None,
            question_id=None if question is None else question.id,
            created_at=created
            or datetime(
                self.today.year,
                self.today.month,
                self.today.day,
                10,
                0,
                tzinfo=timezone.utc,
            ),
        )
        self.session.add(row)
        self.session.commit()
        return row

    def _link(self, task: DailyTask, evidence: MasteryEvidence) -> None:
        self.session.add(
            ReinforceTaskEvidence(task_id=task.id, evidence_id=evidence.id)
        )
        self.session.commit()

    def _chunk(self, user: User, content: str) -> None:
        self.session.add(
            UserDocument(
                user_id=user.id,
                doc_id="notes",
                filename="笔记.txt",
                file_type="txt",
                chunk_index=0,
                content=content,
            )
        )
        self.session.commit()

    def test_retest_anchors_knowledge_point_to_phase_a_not_b(self) -> None:
        user = self._user()
        self._verified(user)
        plan, phase_a, phase_b = self._plan_two_phases(user)
        done_a = self._task(plan, phase_a, "阶段A已完成任务")
        self._task(plan, phase_b, "阶段B已完成任务")
        seed_q = self._question(user, done_a, "触发补强的错题")
        seed_ev = self._evidence(user, phase_a, seed_q, "wrong")
        reinforce_task = self._task(plan, phase_a, "重做错题：触发补强", status="pending")
        self._link(reinforce_task, seed_ev)
        self._chunk(user, "阶段A：重做错题：触发补强 的关键结论")

        def generator(lines, context):
            self.assertTrue(any("阶段A" in line for line in lines))
            return {
                "questions": [
                    {
                        "subject": "数学",
                        "question": "重测锚定题",
                        "answer": "答案",
                        "explanation": "",
                    }
                ]
            }

        rows = asyncio.run(
            practice_service.generate_reinforce_retest(
                self.session, user.id, phase_a.id, generator
            )
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].source_task_id, reinforce_task.id)
        self.assertNotEqual(rows[0].source_task_id, done_a.id)

        def grader(question_text, answer, source):
            return {"result": "correct", "reason": "作答正确", "error_tag": ""}

        evidence = asyncio.run(
            practice_service.grade_answer(
                self.session, user.id, rows[0].id, "答案", grader
            )
        )
        self.assertEqual(evidence.knowledge_point, phase_a.id)
        self.assertNotEqual(evidence.knowledge_point, phase_b.id)
        self.assertIsNotNone(evidence.knowledge_point)

    def test_phase_reinforce_outcome_splits_before_and_after(self) -> None:
        user = self._user()
        plan, phase_a, _phase_b = self._plan_two_phases(user)
        normal = self._task(plan, phase_a, "普通任务")
        reinforce = self._task(plan, phase_a, "补强任务", status="pending")
        before_q = self._question(user, normal, "补强前题")
        after_q = self._question(user, reinforce, "补强后题")
        before_ev = self._evidence(user, phase_a, before_q, "wrong")
        self._evidence(user, phase_a, before_q, "correct")
        after_ev = self._evidence(user, phase_a, after_q, "correct")
        self._link(reinforce, before_ev)
        # before: wrong=0 + correct=100 → 50; after: correct=100
        # overall: 0+100+100 → 67
        outcome = reinforce_service.phase_reinforce_outcome(
            self.session, user.id, phase_a.id
        )
        self.assertEqual(outcome["phaseId"], str(phase_a.id))
        self.assertEqual(outcome["before"]["evidenceCount"], 2)
        self.assertEqual(outcome["before"]["percent"], 50)
        self.assertEqual(outcome["after"]["evidenceCount"], 1)
        self.assertEqual(outcome["after"]["percent"], 100)
        self.assertEqual(outcome["after"]["correctCount"], 1)
        self.assertEqual(outcome["overall"]["evidenceCount"], 3)
        self.assertEqual(outcome["overall"]["percent"], 67)
        self.assertEqual(
            outcome["overall"]["evidenceCount"],
            outcome["before"]["evidenceCount"] + outcome["after"]["evidenceCount"],
        )
        self.assertNotEqual(after_ev.id, before_ev.id)

    def test_after_empty_percent_is_none_not_zero(self) -> None:
        user = self._user()
        plan, phase_a, _phase_b = self._plan_two_phases(user)
        normal = self._task(plan, phase_a, "普通任务")
        reinforce = self._task(plan, phase_a, "补强任务", status="pending")
        before_q = self._question(user, normal, "仅补强前")
        before_ev = self._evidence(user, phase_a, before_q, "wrong")
        self._link(reinforce, before_ev)
        outcome = reinforce_service.phase_reinforce_outcome(
            self.session, user.id, phase_a.id
        )
        self.assertEqual(outcome["after"]["evidenceCount"], 0)
        self.assertIsNone(outcome["after"]["percent"])
        self.assertNotEqual(outcome["after"]["percent"], 0)
        self.assertEqual(outcome["after"]["correctCount"], 0)
        self.assertEqual(outcome["overall"]["evidenceCount"], 1)
        self.assertEqual(outcome["overall"]["percent"], 0)

    def test_overall_percent_is_full_history_not_after_alone(self) -> None:
        """12 before mixed + 3 after all correct → overall is not 100."""
        user = self._user()
        plan, phase_a, _phase_b = self._plan_two_phases(user)
        normal = self._task(plan, phase_a, "普通任务")
        reinforce = self._task(plan, phase_a, "补强任务", status="pending")
        before_q = self._question(user, normal, "补强前题")
        after_q = self._question(user, reinforce, "补强后题")
        link_ev: MasteryEvidence | None = None
        for _ in range(6):
            self._evidence(user, phase_a, before_q, "correct")
            link_ev = self._evidence(user, phase_a, before_q, "wrong")
        assert link_ev is not None
        self._link(reinforce, link_ev)
        for _ in range(3):
            self._evidence(user, phase_a, after_q, "correct")
        outcome = reinforce_service.phase_reinforce_outcome(
            self.session, user.id, phase_a.id
        )
        self.assertEqual(outcome["before"]["evidenceCount"], 12)
        self.assertEqual(outcome["after"]["evidenceCount"], 3)
        self.assertEqual(outcome["after"]["correctCount"], 3)
        self.assertEqual(outcome["after"]["percent"], 100)
        self.assertEqual(
            outcome["overall"]["evidenceCount"],
            outcome["before"]["evidenceCount"] + outcome["after"]["evidenceCount"],
        )
        # (6*100 + 6*0 + 3*100) / 15 = 60
        self.assertEqual(outcome["overall"]["percent"], 60)
        self.assertNotEqual(outcome["overall"]["percent"], 100)

    def test_overall_empty_percent_is_none(self) -> None:
        user = self._user()
        plan, phase_a, phase_b = self._plan_two_phases(user)
        reinforce = self._task(plan, phase_a, "补强任务", status="pending")
        # Evidence on phase_b so phase_a has zero scored rows.
        q = self._question(user, reinforce, "外阶段证据")
        ev = self._evidence(user, phase_b, q, "wrong")
        self._link(reinforce, ev)
        outcome = reinforce_service.phase_reinforce_outcome(
            self.session, user.id, phase_a.id
        )
        self.assertEqual(outcome["overall"]["evidenceCount"], 0)
        self.assertIsNone(outcome["overall"]["percent"])
        self.assertIsNot(outcome["overall"]["percent"], 0)

    def test_outcome_includes_evidence_outside_week_window(self) -> None:
        user = self._user()
        plan, phase_a, _phase_b = self._plan_two_phases(user)
        normal = self._task(plan, phase_a, "普通任务")
        reinforce = self._task(plan, phase_a, "补强任务", status="pending")
        before_q = self._question(user, normal, "窗外证据")
        old = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
        before_ev = self._evidence(
            user, phase_a, before_q, "correct", created=old
        )
        self._link(reinforce, before_ev)
        # Current ISO week around 2026-10-14 does not include 2026-01-01.
        self.assertLess(old.date(), self.today - timedelta(days=14))
        outcome = reinforce_service.phase_reinforce_outcome(
            self.session, user.id, phase_a.id
        )
        self.assertEqual(outcome["before"]["evidenceCount"], 1)
        self.assertEqual(outcome["before"]["percent"], 100)

    def test_retest_refuses_when_phase_has_no_reinforce_task(self) -> None:
        user = self._user()
        self._verified(user)
        plan, phase_a, _phase_b = self._plan_two_phases(user)
        self._task(plan, phase_a, "仅普通任务")
        self._chunk(user, "普通任务内容")

        def generator(lines, context):
            return {
                "questions": [
                    {
                        "subject": "数学",
                        "question": "不该生成",
                        "answer": "x",
                        "explanation": "",
                    }
                ]
            }

        with self.assertRaises(PracticeValidationError):
            asyncio.run(
                practice_service.generate_reinforce_retest(
                    self.session, user.id, phase_a.id, generator
                )
            )
        self.assertEqual(
            list(self.session.scalars(select(PracticeQuestion))),
            [],
        )


if __name__ == "__main__":
    unittest.main()
