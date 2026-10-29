"""Batch 27: graded evidence keeps its task and phase when a plan is rebuilt.

Grading writes ``MasteryEvidence.knowledge_point`` from the source task's
phase but leaves ``PracticeQuestion.status`` at ``pending``. Protection that
looks only at ``correct``/``wrong`` therefore let a rebuild delete the task and
the phase the evidence points at. These tests pin the widened protection set
and the paths that must not change.
"""

from __future__ import annotations

import os
import unittest
from datetime import timedelta
from pathlib import Path

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
    MasteryEvidence,
    Phase,
    Plan,
    PracticeQuestion,
    User,
)
from app.services import (
    adjustment_service,
    planner_service,
    practice_service,
    weekly_review_service,
)

# Frozen at batch 27: this batch adds no migration. A future batch that does
# must bump this number on purpose.
# 26 = +resume_documents（简历编辑器快照按账号保存）。
# 29 = +b1c2d3e4f5a6 平台计费四表、+b2f9e8d7c6a5 调用单价快照，
#      以及此前批次漏计的一支迁移（27 时该断言已失败，本轮一并校正）。
# 30 = +c3a1b2c3d4e5 积分批次（credit_lots / credit_calls / credit_ledger）。
MIGRATION_FILE_COUNT = 30


def _structure() -> dict:
    """Two phases with one 20-minute task each, dated today."""
    today = local_today()
    return {
        "phases": [
            {
                "name": f"重建阶段{i + 1}",
                "start_date": today.isoformat(),
                "end_date": (today + timedelta(days=2)).isoformat(),
                "daily_tasks": [
                    {
                        "task_date": today.isoformat(),
                        "week_label": "W01",
                        "description": f"重建任务{i + 1}",
                        "estimated_minutes": 20,
                    }
                ],
            }
            for i in range(2)
        ]
    }


def _generator():
    def generate(fields, used_docs, context_text, instruction):
        return _structure()

    return generate


def _grader(result: str):
    def grade(question: str, answer: str, source_text: str) -> dict:
        return {"result": result, "reason": "缺少中值条件", "error_tag": "概念"}

    return grade


class EvidencePhaseOwnershipTests(unittest.IsolatedAsyncioTestCase):
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

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    # -- fixtures ---------------------------------------------------------

    def _user(self, verified: bool = True) -> User:
        user = User(username=f"ev-{os.urandom(4).hex()}", password_hash="x" * 20)
        self.session.add(user)
        self.session.flush()
        if verified:
            self.session.add(
                ApiConfig(
                    user_id=user.id,
                    api_key_cipher="cipher",
                    model_type="gpt",
                    base_url="https://example.com/v1/chat/completions",
                    is_verified=True,
                )
            )
        self.session.commit()
        return user

    def _plan(
        self, user: User, name: str = "基础阶段"
    ) -> tuple[Plan, Phase, DailyTask]:
        plan = Plan(
            user_id=user.id,
            goal_name="考研数学",
            start_date=self.today,
            goal_date=self.today + timedelta(days=90),
            current_level="零基础",
            daily_minutes=90,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        phase = Phase(
            plan_id=plan.id,
            phase_index=1,
            name=name,
            start_date=self.today,
            end_date=self.today + timedelta(days=10),
            is_current=True,
        )
        self.session.add(phase)
        self.session.flush()
        task = DailyTask(
            plan_id=plan.id,
            phase_id=phase.id,
            task_date=self.today + timedelta(days=1),
            week_label="W01",
            description="复述中值定理",
            status="pending",
            estimated_minutes=20,
        )
        self.session.add(task)
        self.session.commit()
        return plan, phase, task

    def _question(
        self,
        user: User,
        task: DailyTask | None,
        status: str = "pending",
    ) -> PracticeQuestion:
        row = PracticeQuestion(
            user_id=user.id,
            source="generated",
            subject="数学",
            question="中值定理的条件是什么",
            answer="连续",
            explanation="",
            source_task_id=None if task is None else task.id,
            status=status,
        )
        self.session.add(row)
        self.session.commit()
        return row

    async def _grade(
        self, user: User, task: DailyTask, result: str = "wrong"
    ) -> tuple[PracticeQuestion, MasteryEvidence]:
        question = self._question(user, task)
        evidence = await practice_service.grade_answer(
            self.session,
            user.id,
            question.id,
            "闭区间连续",
            _grader(result),
        )
        return question, evidence

    def _evidence_count(self) -> int:
        return int(
            self.session.scalar(select(func.count()).select_from(MasteryEvidence)) or 0
        )

    # -- the defect -------------------------------------------------------

    async def test_regenerate_keeps_graded_pending_task_and_phase(self) -> None:
        user = self._user()
        plan, phase, task = self._plan(user)
        question, evidence = await self._grade(user, task)

        # Grading writes evidence but does not flip the question status.
        self.assertEqual(question.status, "pending")
        self.assertEqual(evidence.knowledge_point, phase.id)
        before = self._evidence_count()

        await planner_service.regenerate_plan(
            self.session, user.id, plan.id, "重排", plan_generator=_generator()
        )

        self.session.expire_all()
        self.assertIsNotNone(
            self.session.get(DailyTask, task.id),
            "有掌握度证据的来源任务被重建删掉了",
        )
        kept_phase = self.session.get(Phase, phase.id)
        self.assertIsNotNone(kept_phase, "证据指向的阶段在重建后被删除")
        self.assertEqual(kept_phase.plan_id, plan.id)
        self.assertEqual(self._evidence_count(), before)

    # -- behaviour that must stay the same --------------------------------

    async def test_pending_task_without_evidence_is_still_replaced(self) -> None:
        user = self._user()
        plan, phase, task = self._plan(user)
        self._question(user, task, status="pending")

        await planner_service.regenerate_plan(
            self.session, user.id, plan.id, "重排", plan_generator=_generator()
        )

        self.session.expire_all()
        self.assertIsNone(self.session.get(DailyTask, task.id))
        self.assertIsNone(self.session.get(Phase, phase.id))

    async def test_correct_status_protection_is_unchanged(self) -> None:
        user = self._user()
        plan, phase, task = self._plan(user)
        self._question(user, task, status="correct")

        await planner_service.regenerate_plan(
            self.session, user.id, plan.id, "重排", plan_generator=_generator()
        )

        self.session.expire_all()
        self.assertIsNotNone(self.session.get(DailyTask, task.id))
        self.assertIsNotNone(self.session.get(Phase, phase.id))

    async def test_another_users_question_does_not_protect_my_task(self) -> None:
        owner = self._user()
        plan, phase, task = self._plan(owner)
        stranger = self._user(verified=False)
        # A row that points at the owner's task but belongs to another user.
        self._question(stranger, task, status="correct")

        await planner_service.regenerate_plan(
            self.session, owner.id, plan.id, "重排", plan_generator=_generator()
        )

        self.session.expire_all()
        self.assertIsNone(self.session.get(DailyTask, task.id))
        self.assertIsNone(self.session.get(Phase, phase.id))

    # -- widened protection ----------------------------------------------

    async def test_multiple_evidence_rows_protect_the_task_once(self) -> None:
        user = self._user()
        plan, phase, task = self._plan(user)
        await self._grade(user, task, result="wrong")
        await self._grade(user, task, result="partial")
        self.assertEqual(self._evidence_count(), 2)

        await planner_service.regenerate_plan(
            self.session, user.id, plan.id, "重排", plan_generator=_generator()
        )

        self.session.expire_all()
        self.assertIsNotNone(self.session.get(DailyTask, task.id))
        self.assertIsNotNone(self.session.get(Phase, phase.id))
        # Kept once: one phase row with that id, one task still on it.
        self.assertEqual(
            int(
                self.session.scalar(
                    select(func.count())
                    .select_from(Phase)
                    .where(Phase.id == phase.id)
                )
                or 0
            ),
            1,
        )
        self.assertEqual(
            int(
                self.session.scalar(
                    select(func.count())
                    .select_from(DailyTask)
                    .where(DailyTask.phase_id == phase.id)
                )
                or 0
            ),
            1,
        )
        self.assertEqual(
            int(
                self.session.scalar(
                    select(func.count())
                    .select_from(Phase)
                    .where(Phase.plan_id == plan.id)
                )
                or 0
            ),
            3,
        )
        self.assertEqual(self._evidence_count(), 2)

    async def test_evidence_rows_are_untouched_by_rebuild(self) -> None:
        user = self._user()
        plan, phase, task = self._plan(user)
        _, evidence = await self._grade(user, task)
        before = self.session.scalars(select(MasteryEvidence)).all()

        await planner_service.regenerate_plan(
            self.session, user.id, plan.id, "重排", plan_generator=_generator()
        )

        self.session.expire_all()
        after = self.session.scalars(select(MasteryEvidence)).all()
        self.assertEqual([row.id for row in after], [row.id for row in before])
        self.assertEqual([row.result for row in after], [row.result for row in before])
        self.assertEqual(after[0].knowledge_point, phase.id)
        self.assertEqual(after[0].id, evidence.id)

    async def test_phase_mastery_matches_before_and_after_rebuild(self) -> None:
        user = self._user()
        plan, phase, task = self._plan(user)
        await self._grade(user, task, result="partial")
        week_start, week_end = weekly_review_service.week_bounds(self.today)

        _, before_detail = weekly_review_service.phase_mastery(
            self.session, user.id, week_start, week_end
        )
        before_row = next(
            item for item in before_detail if item["phaseId"] == str(phase.id)
        )

        await planner_service.regenerate_plan(
            self.session, user.id, plan.id, "重排", plan_generator=_generator()
        )
        self.session.expire_all()
        self.assertIsNotNone(
            self.session.get(Phase, phase.id), "证据所在阶段在重建后被删除"
        )

        _, after_detail = weekly_review_service.phase_mastery(
            self.session, user.id, week_start, week_end
        )
        after_row = next(
            item for item in after_detail if item["phaseId"] == str(phase.id)
        )
        self.assertEqual(after_row["percent"], before_row["percent"])
        self.assertEqual(after_row["evidenceCount"], before_row["evidenceCount"])

    async def test_adjustment_confirm_keeps_graded_task_and_phase(self) -> None:
        user = self._user()
        plan, phase, task = self._plan(user)
        await self._grade(user, task)

        preview = await adjustment_service.create_preview(
            self.session,
            user.id,
            plan.id,
            "重排",
            None,
            [],
            _generator(),
        )
        removed = [item["id"] for item in preview.diff["removedOrReplaced"]]
        kept = [item["id"] for item in preview.diff["keptTasks"]]
        self.assertNotIn(str(task.id), removed)
        self.assertIn(str(task.id), kept)

        adjustment_service.confirm_adjustment(
            self.session,
            user.id,
            plan.id,
            preview.id,
            expected_selection_version=preview.proposal["selectionVersion"],
        )

        self.session.expire_all()
        self.assertIsNotNone(self.session.get(DailyTask, task.id))
        self.assertIsNotNone(self.session.get(Phase, phase.id))
        self.assertEqual(self._evidence_count(), 1)

    # -- no schema change -------------------------------------------------

    def test_migration_file_count_unchanged(self) -> None:
        versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
        files = sorted(path.name for path in versions.glob("*.py"))
        self.assertEqual(len(files), MIGRATION_FILE_COUNT)
