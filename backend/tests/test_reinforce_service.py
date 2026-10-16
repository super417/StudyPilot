"""Reinforce tasks: divergence + real wrong/partial evidence, preview before write."""

from __future__ import annotations

import base64
import os
import unittest
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import (
    DailyTask,
    MasteryEvidence,
    Phase,
    Plan,
    PlanAdjustment,
    PracticeQuestion,
    ReinforceTaskEvidence,
    User,
)
from app.services import reinforce_service, weekly_review_service
from app.services.divergence import DIVERGENCE_THRESHOLD


class ReinforceServiceTests(unittest.TestCase):
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
        self.week_start, self.week_end = weekly_review_service.week_bounds(self.today)

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _user(self) -> User:
        user = User(username=f"rf-{os.urandom(4).hex()}", password_hash="x")
        self.session.add(user)
        self.session.commit()
        return user

    def _plan_phase(self, user: User) -> tuple[Plan, Phase]:
        plan = Plan(
            user_id=user.id,
            goal_name="补强目标",
            start_date=date(2026, 1, 1),
            goal_date=date(2026, 12, 31),
            current_level="入门",
            daily_minutes=60,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        phase = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="阶段一",
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            is_current=True,
        )
        self.session.add(phase)
        self.session.commit()
        return plan, phase

    def _tasks(self, plan: Plan, phase: Phase, done: int, total: int) -> None:
        for index in range(total):
            self.session.add(
                DailyTask(
                    plan_id=plan.id,
                    phase_id=phase.id,
                    task_date=self.today,
                    week_label="W42",
                    description=f"任务 {index + 1}",
                    status="done" if index < done else "pending",
                )
            )
        self.session.commit()

    def _question(self, user: User, text: str = "中值定理要求什么") -> PracticeQuestion:
        row = PracticeQuestion(
            user_id=user.id,
            source="generated",
            subject="数学",
            question=text,
            answer="连续",
            explanation="",
            status="wrong",
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
        source_ref: str | None,
        created: datetime | None = None,
    ) -> MasteryEvidence:
        row = MasteryEvidence(
            user_id=user.id,
            knowledge_point=phase.id,
            evidence_type="quiz",
            result=result,
            answer_text="作答",
            grade_reason="按作答判断",
            source_ref=source_ref,
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

    def _divergent_with_wrong(
        self,
        *,
        source_ref: str | None = "docA#0",
        gap: int = DIVERGENCE_THRESHOLD,
    ) -> tuple[User, Plan, Phase, PracticeQuestion, MasteryEvidence]:
        """Build completion 100 and mastery such that gap is exactly ``gap``.

        gap 30 → mastery 70: seven correct + three wrong.
        gap 29 → mastery 71: five correct + two wrong (500/7 ≈ 71.43 → 71).
        """
        user = self._user()
        plan, phase = self._plan_phase(user)
        # Keep a large done base so a few pending reinforce tasks cannot
        # drop completion enough to clear the divergence window
        # (e.g. 100/104 → 96, mastery 64 → gap 32 ≥ threshold).
        self._tasks(plan, phase, done=100, total=100)
        question = self._question(user)
        wrong = self._evidence(user, phase, question, "wrong", source_ref)
        if gap == DIVERGENCE_THRESHOLD:
            # 700/10 = 70 → gap 30
            for index in range(7):
                self._evidence(
                    user,
                    phase,
                    self._question(user, f"正确题 {index}"),
                    "correct",
                    None,
                )
            for index in range(2):
                self._evidence(
                    user,
                    phase,
                    self._question(user, f"错题 {index}"),
                    "wrong",
                    None,
                )
        elif gap == DIVERGENCE_THRESHOLD - 1:
            # 500/7 ≈ 71.43 → 71 → gap 29
            for index in range(5):
                self._evidence(
                    user,
                    phase,
                    self._question(user, f"正确题 {index}"),
                    "correct",
                    None,
                )
            self._evidence(
                user,
                phase,
                self._question(user, "另一错题"),
                "wrong",
                None,
            )
        else:
            raise AssertionError(f"test helper does not cover gap={gap}")
        _avg, detail = weekly_review_service.phase_mastery(
            self.session, user.id, self.week_start, self.week_end
        )
        self.assertEqual(detail[0]["completionRate"], 100)
        self.assertEqual(detail[0]["percent"], 100 - gap)
        return user, plan, phase, question, wrong

    def test_no_error_evidence_yields_zero_tasks(self) -> None:
        user = self._user()
        plan, phase = self._plan_phase(user)
        self._tasks(plan, phase, done=3, total=3)
        question = self._question(user)
        self._evidence(user, phase, question, "correct", "docA#0")
        self._evidence(
            user,
            phase,
            self._question(user, "第二题"),
            "correct",
            None,
        )
        before = self.session.scalar(select(func.count()).select_from(DailyTask)) or 0
        row = reinforce_service.create_reinforce_preview(
            self.session, user.id, plan.id, today=self.today
        )
        tasks = (row.proposal or {}).get("tasks") or []
        self.assertEqual(tasks, [])
        after = self.session.scalar(select(func.count()).select_from(DailyTask)) or 0
        self.assertEqual(after, before)

    def test_preview_does_not_write_daily_tasks(self) -> None:
        user, plan, phase, question, evidence = self._divergent_with_wrong()
        before = self.session.scalar(select(func.count()).select_from(DailyTask)) or 0
        row = reinforce_service.create_reinforce_preview(
            self.session, user.id, plan.id, today=self.today
        )
        tasks = (row.proposal or {}).get("tasks") or []
        self.assertGreaterEqual(len(tasks), 1)
        after = self.session.scalar(select(func.count()).select_from(DailyTask)) or 0
        self.assertEqual(after, before)
        self.assertEqual((row.proposal or {}).get("kind"), "reinforce")
        self.assertTrue(
            any(ref.get("evidenceId") == str(evidence.id) for ref in row.evidence_refs)
        )

    def test_undo_restores_tasks(self) -> None:
        user, plan, phase, question, evidence = self._divergent_with_wrong()
        before_ids = {
            str(task.id)
            for task in self.session.scalars(
                select(DailyTask).where(DailyTask.plan_id == plan.id)
            )
        }
        preview = reinforce_service.create_reinforce_preview(
            self.session, user.id, plan.id, today=self.today
        )
        confirmed = reinforce_service.confirm_reinforce(
            self.session,
            user.id,
            plan.id,
            preview.id,
            expected_selection_version=1,
        )
        self.assertEqual(confirmed.status, "confirmed")
        created = set((confirmed.applied_record or {}).get("createdTaskIds") or [])
        self.assertGreaterEqual(len(created), 1)
        after_confirm = {
            str(task.id)
            for task in self.session.scalars(
                select(DailyTask).where(DailyTask.plan_id == plan.id)
            )
        }
        self.assertTrue(created.issubset(after_confirm))
        undone = reinforce_service.undo_reinforce(self.session, user.id, plan.id)
        self.assertEqual(undone.status, "undone")
        restored = {
            str(task.id)
            for task in self.session.scalars(
                select(DailyTask).where(DailyTask.plan_id == plan.id)
            )
        }
        self.assertEqual(restored, before_ids)
        for task_id in created:
            self.assertIsNone(self.session.get(DailyTask, uuid.UUID(task_id)))

    def test_reread_source_must_match_evidence_source_ref(self) -> None:
        user, plan, phase, question, evidence = self._divergent_with_wrong(
            source_ref="notes#2"
        )
        preview = reinforce_service.create_reinforce_preview(
            self.session, user.id, plan.id, today=self.today
        )
        reread = [
            item
            for item in (preview.proposal or {}).get("tasks") or []
            if item.get("kind") == "reread"
        ]
        self.assertEqual(len(reread), 1)
        self.assertEqual(reread[0]["sourceRef"], evidence.source_ref)
        self.assertEqual(reread[0]["sourceRef"], "notes#2")
        self.assertEqual(reread[0]["evidenceId"], str(evidence.id))

    def test_gap_below_threshold_yields_zero_tasks(self) -> None:
        user, plan, *_ = self._divergent_with_wrong(gap=DIVERGENCE_THRESHOLD - 1)
        row = reinforce_service.create_reinforce_preview(
            self.session, user.id, plan.id, today=self.today
        )
        self.assertEqual((row.proposal or {}).get("tasks") or [], [])

    def test_gap_at_threshold_generates_tasks(self) -> None:
        user, plan, *_ = self._divergent_with_wrong(gap=DIVERGENCE_THRESHOLD)
        row = reinforce_service.create_reinforce_preview(
            self.session, user.id, plan.id, today=self.today
        )
        self.assertGreaterEqual(len((row.proposal or {}).get("tasks") or []), 1)

    def test_missing_source_ref_only_generates_redo(self) -> None:
        user, plan, *_ = self._divergent_with_wrong(source_ref=None)
        row = reinforce_service.create_reinforce_preview(
            self.session, user.id, plan.id, today=self.today
        )
        tasks = (row.proposal or {}).get("tasks") or []
        kinds = {item.get("kind") for item in tasks}
        self.assertIn("redo", kinds)
        self.assertNotIn("reread", kinds)

    def test_confirm_writes_tasks_into_phase(self) -> None:
        user, plan, phase, question, evidence = self._divergent_with_wrong()
        preview = reinforce_service.create_reinforce_preview(
            self.session, user.id, plan.id, today=self.today
        )
        confirmed = reinforce_service.confirm_reinforce(
            self.session,
            user.id,
            plan.id,
            preview.id,
            expected_selection_version=1,
        )
        created_ids = (confirmed.applied_record or {}).get("createdTaskIds") or []
        self.assertGreaterEqual(len(created_ids), 1)
        for task_id in created_ids:
            task = self.session.get(DailyTask, uuid.UUID(task_id))
            self.assertIsNotNone(task)
            self.assertEqual(task.phase_id, phase.id)
            self.assertEqual(task.plan_id, plan.id)
            self.assertEqual(task.status, "pending")
        links = list(
            self.session.scalars(
                select(ReinforceTaskEvidence).where(
                    ReinforceTaskEvidence.evidence_id == evidence.id
                )
            )
        )
        self.assertGreaterEqual(len(links), 1)

    def _task_evidence_ids(self, row: PlanAdjustment) -> set[str]:
        return {
            str(item.get("evidenceId"))
            for item in (row.proposal or {}).get("tasks") or []
            if item.get("evidenceId")
        }

    def test_preview_twice_does_not_repeat_same_evidence(self) -> None:
        user, plan, phase, question, evidence = self._divergent_with_wrong()
        first = reinforce_service.create_reinforce_preview(
            self.session, user.id, plan.id, today=self.today
        )
        first_ids = self._task_evidence_ids(first)
        self.assertIn(str(evidence.id), first_ids)
        second = reinforce_service.create_reinforce_preview(
            self.session, user.id, plan.id, today=self.today
        )
        second_ids = self._task_evidence_ids(second)
        self.assertNotIn(str(evidence.id), second_ids)

    def test_preview_after_confirm_does_not_repeat_same_evidence(self) -> None:
        user, plan, phase, question, evidence = self._divergent_with_wrong()
        preview = reinforce_service.create_reinforce_preview(
            self.session, user.id, plan.id, today=self.today
        )
        reinforce_service.confirm_reinforce(
            self.session,
            user.id,
            plan.id,
            preview.id,
            expected_selection_version=1,
        )
        again = reinforce_service.create_reinforce_preview(
            self.session, user.id, plan.id, today=self.today
        )
        self.assertNotIn(str(evidence.id), self._task_evidence_ids(again))
        self.assertGreaterEqual(
            self.session.scalar(
                select(func.count())
                .select_from(ReinforceTaskEvidence)
                .where(ReinforceTaskEvidence.evidence_id == evidence.id)
            )
            or 0,
            1,
        )

    def test_undo_allows_regenerate_for_same_evidence(self) -> None:
        user, plan, phase, question, evidence = self._divergent_with_wrong()
        preview = reinforce_service.create_reinforce_preview(
            self.session, user.id, plan.id, today=self.today
        )
        reinforce_service.confirm_reinforce(
            self.session,
            user.id,
            plan.id,
            preview.id,
            expected_selection_version=1,
        )
        reinforce_service.undo_reinforce(self.session, user.id, plan.id)
        link_count = self.session.scalar(
            select(func.count())
            .select_from(ReinforceTaskEvidence)
            .where(ReinforceTaskEvidence.evidence_id == evidence.id)
        )
        self.assertEqual(link_count, 0)
        regenerated = reinforce_service.create_reinforce_preview(
            self.session, user.id, plan.id, today=self.today
        )
        self.assertIn(str(evidence.id), self._task_evidence_ids(regenerated))

    def test_new_error_evidence_still_generates_after_prior_reinforce(self) -> None:
        user, plan, phase, question, evidence = self._divergent_with_wrong()
        preview = reinforce_service.create_reinforce_preview(
            self.session, user.id, plan.id, today=self.today
        )
        reinforce_service.confirm_reinforce(
            self.session,
            user.id,
            plan.id,
            preview.id,
            expected_selection_version=1,
        )
        fresh_question = self._question(user, "新错题不误伤")
        fresh = self._evidence(
            user, phase, fresh_question, "wrong", "fresh-doc#1"
        )
        again = reinforce_service.create_reinforce_preview(
            self.session, user.id, plan.id, today=self.today
        )
        again_ids = self._task_evidence_ids(again)
        self.assertIn(str(fresh.id), again_ids)
        self.assertNotIn(str(evidence.id), again_ids)


if __name__ == "__main__":
    unittest.main()
