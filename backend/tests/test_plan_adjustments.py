"""Batch-2: persistent adjustment preview / confirm / reject / undo."""

from __future__ import annotations

import os
import unittest
import uuid
from datetime import timedelta

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.clock import local_today
from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import (
    ApiConfig,
    CheckIn,
    DailyTask,
    Mistake,
    Phase,
    Plan,
    PlanAdjustment,
    PracticeQuestion,
    User,
)
from app.services import adjustment_service, planner_service


def _structure(phase_count: int = 2, label: str = "新安排") -> dict:
    today = local_today()
    return {
        "phases": [
            {
                "name": f"{label}阶段{i + 1}",
                "start_date": today.isoformat(),
                "end_date": (today + timedelta(days=2)).isoformat(),
                "daily_tasks": [
                    {
                        "task_date": (today + timedelta(days=offset)).isoformat(),
                        "week_label": "W01",
                        "description": f"{label}P{i + 1}D{offset}",
                    }
                    for offset in range(3)
                ],
            }
            for i in range(phase_count)
        ]
    }


class PlanAdjustmentServiceTests(unittest.IsolatedAsyncioTestCase):
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
        self.user = User(username=f"adj-{os.urandom(4).hex()}", password_hash="x" * 20)
        self.session.add(self.user)
        self.session.commit()
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
        self.plan = Plan(
            user_id=self.user.id,
            goal_name="考研数学",
            start_date=self.today - timedelta(days=5),
            goal_date=self.today + timedelta(days=90),
            current_level="零基础",
            daily_minutes=90,
            total_phases=2,
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
        self.past = DailyTask(
            plan_id=self.plan.id,
            phase_id=self.phase.id,
            task_date=self.today - timedelta(days=2),
            week_label="W01",
            description="过去保留",
            status="pending",
        )
        self.done = DailyTask(
            plan_id=self.plan.id,
            phase_id=self.phase.id,
            task_date=self.today,
            week_label="W01",
            description="已完成保留",
            status="done",
        )
        self.pending = DailyTask(
            plan_id=self.plan.id,
            phase_id=self.phase.id,
            task_date=self.today + timedelta(days=3),
            week_label="W01",
            description="将来可替换",
            status="pending",
        )
        self.session.add_all([self.past, self.done, self.pending])
        self.session.flush()
        self.carried = DailyTask(
            plan_id=self.plan.id,
            phase_id=self.phase.id,
            task_date=self.today + timedelta(days=1),
            week_label="W01",
            description="已顺延保留",
            status="carried",
            carried_from_id=self.past.id,
        )
        self.practice = PracticeQuestion(
            user_id=self.user.id,
            source="uploaded",
            question="题干",
            answer="作答",
            explanation="解析",
            status="wrong",
            source_task_id=self.done.id,
        )
        self.check_in = CheckIn(
            user_id=self.user.id,
            check_date=self.today,
            duration_minutes=30,
            difficulty=3,
            energy=3,
            note="打卡",
        )
        self.mistake = Mistake(
            user_id=self.user.id,
            question="错题",
            my_answer="错",
            why_wrong="因",
            correct_understanding="对",
        )
        self.session.add_all([self.carried, self.practice, self.check_in, self.mistake])
        self.session.commit()
        self.protected_ids = {self.past.id, self.done.id, self.carried.id}
        self.pending_id = self.pending.id

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _generator(self, label: str = "新安排"):
        def generator(fields, used_docs, context_text, instruction):
            return _structure(2, label=label)

        return generator

    def _task_map(self) -> dict[uuid.UUID, DailyTask]:
        rows = list(
            self.session.scalars(
                select(DailyTask).where(DailyTask.plan_id == self.plan.id)
            )
        )
        return {row.id: row for row in rows}

    async def test_preview_and_reject_do_not_mutate_plan(self) -> None:
        before = {
            task_id: (task.description, task.task_date, task.status)
            for task_id, task in self._task_map().items()
        }
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "压缩阶段",
            None,
            [],
            self._generator(),
        )
        self.assertEqual(preview.status, "pending")
        self.assertIsNotNone(preview.diff)
        self.assertTrue(preview.validation.get("ok"))
        after_preview = self._task_map()
        self.assertEqual(set(after_preview), set(before))
        for task_id, triple in before.items():
            task = after_preview[task_id]
            self.assertEqual(
                (task.description, task.task_date, task.status), triple
            )

        rejected = adjustment_service.reject_adjustment(
            self.session, self.user.id, self.plan.id, preview.id
        )
        self.assertEqual(rejected.status, "rejected")
        after_reject = self._task_map()
        self.assertEqual(set(after_reject), set(before))
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.confirm_adjustment(
                self.session, self.user.id, self.plan.id, preview.id
            )

    async def test_confirm_applies_once_keeps_protected_and_links(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "重排未来",
            None,
            [],
            self._generator("生效"),
        )
        first = adjustment_service.confirm_adjustment(
            self.session, self.user.id, self.plan.id, preview.id
        )
        self.assertEqual(first.status, "confirmed")
        self.session.expire_all()
        self.assertIsNone(self.session.get(DailyTask, self.pending_id))
        for task_id in self.protected_ids:
            task = self.session.get(DailyTask, task_id)
            self.assertIsNotNone(task)
            self.assertEqual(task.phase_id, self.phase.id)
        self.assertEqual(
            self.session.get(PracticeQuestion, self.practice.id).source_task_id,
            self.done.id,
        )
        self.assertEqual(
            self.session.get(CheckIn, self.check_in.id).note, "打卡"
        )
        self.assertEqual(
            self.session.get(Mistake, self.mistake.id).question, "错题"
        )
        second = adjustment_service.confirm_adjustment(
            self.session, self.user.id, self.plan.id, preview.id
        )
        self.assertEqual(second.id, first.id)
        self.assertEqual(second.status, "confirmed")

    async def test_basis_change_blocks_confirm(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "改",
            None,
            [],
            self._generator(),
        )
        self.pending.description = "人工改过"
        self.session.commit()
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.confirm_adjustment(
                self.session, self.user.id, self.plan.id, preview.id
            )
        self.session.expire_all()
        self.assertEqual(
            self.session.get(DailyTask, self.pending_id).description, "人工改过"
        )
        row = self.session.get(PlanAdjustment, preview.id)
        self.assertEqual(row.status, "conflict")

    async def test_foreign_user_cannot_read_confirm_reject_or_undo(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "改",
            None,
            [],
            self._generator(),
        )
        other = User(username=f"o-{os.urandom(3).hex()}", password_hash="y" * 20)
        self.session.add(other)
        self.session.flush()
        self.session.add(
            ApiConfig(
                user_id=other.id,
                api_key_cipher="cipher",
                model_type="gpt",
                base_url="https://example.com",
                is_verified=True,
            )
        )
        self.session.commit()
        with self.assertRaises(planner_service.PlanNotFoundError):
            adjustment_service.get_adjustment(
                self.session, other.id, self.plan.id, preview.id
            )
        with self.assertRaises(planner_service.PlanNotFoundError):
            adjustment_service.confirm_adjustment(
                self.session, other.id, self.plan.id, preview.id
            )
        with self.assertRaises(planner_service.PlanNotFoundError):
            adjustment_service.reject_adjustment(
                self.session, other.id, self.plan.id, preview.id
            )
        with self.assertRaises(planner_service.PlanNotFoundError):
            adjustment_service.undo_latest(
                self.session, other.id, self.plan.id
            )

    async def test_undo_restores_and_conflicts_on_later_done(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "改",
            None,
            [],
            self._generator("撤销前"),
        )
        confirmed = adjustment_service.confirm_adjustment(
            self.session, self.user.id, self.plan.id, preview.id
        )
        self.session.expire_all()
        created = list(
            self.session.scalars(
                select(DailyTask).where(
                    DailyTask.plan_id == self.plan.id,
                    DailyTask.description.like("撤销前%"),
                )
            )
        )
        self.assertTrue(created)
        undone = adjustment_service.undo_latest(
            self.session, self.user.id, self.plan.id
        )
        self.assertEqual(undone.id, confirmed.id)
        self.assertEqual(undone.status, "undone")
        self.session.expire_all()
        self.assertIsNotNone(self.session.get(DailyTask, self.pending_id))
        self.assertFalse(
            list(
                self.session.scalars(
                    select(DailyTask).where(
                        DailyTask.plan_id == self.plan.id,
                        DailyTask.description.like("撤销前%"),
                    )
                )
            )
        )
        again = adjustment_service.undo_latest(
            self.session, self.user.id, self.plan.id
        )
        self.assertEqual(again.id, confirmed.id)
        self.assertEqual(again.status, "undone")

        preview2 = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "再改",
            None,
            [],
            self._generator("冲突前"),
        )
        confirmed2 = adjustment_service.confirm_adjustment(
            self.session, self.user.id, self.plan.id, preview2.id
        )
        touched = list(
            self.session.scalars(
                select(DailyTask).where(
                    DailyTask.plan_id == self.plan.id,
                    DailyTask.description.like("冲突前%"),
                )
            )
        )[0]
        touched.status = "done"
        self.session.commit()
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.undo_latest(
                self.session, self.user.id, self.plan.id
            )
        self.session.expire_all()
        self.assertEqual(
            self.session.get(PlanAdjustment, confirmed2.id).status, "confirmed"
        )
        self.assertEqual(self.session.get(DailyTask, touched.id).status, "done")

    async def test_check_in_alone_does_not_block_undo(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "改",
            None,
            [],
            self._generator("打卡不挡"),
        )
        confirmed = adjustment_service.confirm_adjustment(
            self.session, self.user.id, self.plan.id, preview.id
        )
        self.session.add(
            CheckIn(
                user_id=self.user.id,
                check_date=self.today,
                duration_minutes=15,
                difficulty=2,
                energy=2,
                note="额外打卡",
            )
        )
        self.session.commit()
        undone = adjustment_service.undo_latest(
            self.session, self.user.id, self.plan.id
        )
        self.assertEqual(undone.id, confirmed.id)
        self.assertEqual(undone.status, "undone")

    async def test_generation_failure_leaves_plan_and_no_skeleton(self) -> None:
        before_ids = set(self._task_map())

        def bad_generator(fields, used_docs, context_text, instruction):
            return {"phases": [{"name": "只有一阶段", "daily_tasks": []}]}

        with self.assertRaises(planner_service.PlanGenerationError):
            await adjustment_service.create_preview(
                self.session,
                self.user.id,
                self.plan.id,
                "坏结构",
                None,
                [],
                bad_generator,
            )
        self.session.rollback()
        self.session.expire_all()
        self.assertEqual(set(self._task_map()), before_ids)
        self.assertEqual(
            self.session.scalar(select(PlanAdjustment).limit(1)),
            None,
        )


if __name__ == "__main__":
    unittest.main()
