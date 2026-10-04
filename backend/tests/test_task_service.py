import base64
import os
import unittest
import uuid
from datetime import date

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import DailyTask, Phase, Plan, User
from app.services import task_service
from app.services.task_service import TaskNotFoundError, TaskStatusValidationError


class TaskServiceTests(unittest.TestCase):
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

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _make_user(self, name: str = "user") -> User:
        user = User(username=f"{name}-{os.urandom(4).hex()}", password_hash="x")
        self.session.add(user)
        self.session.commit()
        return user

    def _make_phase_with_tasks(
        self, user: User, task_count: int
    ) -> tuple[Phase, list[DailyTask]]:
        plan = Plan(
            user_id=user.id,
            goal_name="考研",
            start_date=date(2025, 1, 1),
            goal_date=date(2025, 12, 31),
            current_level="零基础",
            daily_minutes=120,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        phase = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="阶段 1",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 2, 1),
            is_current=True,
        )
        self.session.add(phase)
        self.session.flush()
        tasks = [
            DailyTask(
                plan_id=plan.id,
                phase_id=phase.id,
                task_date=date(2025, 1, 1 + i),
                week_label="W01",
                description=f"任务 {i}",
                status="pending",
            )
            for i in range(task_count)
        ]
        self.session.add_all(tasks)
        self.session.commit()
        return phase, tasks

    def _make_plan_with_task(
        self, user: User, task_date: date, phase_index: int = 1
    ) -> DailyTask:
        plan = Plan(
            user_id=user.id,
            goal_name="考研",
            start_date=date(2025, 1, 1),
            goal_date=date(2025, 12, 31),
            current_level="零基础",
            daily_minutes=120,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        phase = Phase(
            plan_id=plan.id,
            phase_index=phase_index,
            name=f"阶段 {phase_index}",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 2, 1),
        )
        self.session.add(phase)
        self.session.flush()
        task = DailyTask(
            plan_id=plan.id,
            phase_id=phase.id,
            task_date=task_date,
            week_label="W01",
            description=f"任务 {phase_index}",
            status="pending",
        )
        self.session.add(task)
        self.session.commit()
        return task

    # --- get_daily_tasks (query half of task_service) -----------------------

    def test_get_daily_tasks_returns_only_own_tasks(self) -> None:
        target = date(2025, 2, 10)
        mine = self._make_user("mine")
        other = self._make_user("other")
        my_task = self._make_plan_with_task(mine, target)
        self._make_plan_with_task(other, target)

        tasks = task_service.get_daily_tasks(self.session, mine.id, target)
        self.assertEqual([t.id for t in tasks], [my_task.id])

    def test_get_daily_tasks_filters_by_date(self) -> None:
        mine = self._make_user("mine")
        wanted = self._make_plan_with_task(mine, date(2025, 2, 10))
        self._make_plan_with_task(mine, date(2025, 2, 11), phase_index=2)

        tasks = task_service.get_daily_tasks(
            self.session, mine.id, date(2025, 2, 10)
        )
        self.assertEqual([t.id for t in tasks], [wanted.id])

    def test_get_daily_tasks_orders_by_phase_index(self) -> None:
        target = date(2025, 2, 10)
        mine = self._make_user("mine")
        plan = Plan(
            user_id=mine.id,
            goal_name="考研",
            start_date=date(2025, 1, 1),
            goal_date=date(2025, 12, 31),
            current_level="零基础",
            daily_minutes=120,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        # Insert phase 2 before phase 1 to prove ordering is by index, not id.
        phase_two = Phase(
            plan_id=plan.id,
            phase_index=2,
            name="阶段 2",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 2, 1),
        )
        phase_one = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="阶段 1",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 2, 1),
        )
        self.session.add_all([phase_two, phase_one])
        self.session.flush()
        task_in_two = DailyTask(
            plan_id=plan.id,
            phase_id=phase_two.id,
            task_date=target,
            week_label="W01",
            description="阶段2任务",
            status="pending",
        )
        task_in_one = DailyTask(
            plan_id=plan.id,
            phase_id=phase_one.id,
            task_date=target,
            week_label="W01",
            description="阶段1任务",
            status="pending",
        )
        self.session.add_all([task_in_two, task_in_one])
        self.session.commit()

        tasks = task_service.get_daily_tasks(self.session, mine.id, target)
        # phase_index 1 must come before phase_index 2 regardless of insert order.
        self.assertEqual([t.id for t in tasks], [task_in_one.id, task_in_two.id])

    def test_done_updates_phase_progress(self) -> None:
        user = self._make_user()
        phase, tasks = self._make_phase_with_tasks(user, 5)

        _, updated_phase = task_service.set_task_status(
            self.session, user.id, tasks[0].id, "done"
        )
        self.assertEqual(updated_phase.progress_percent, 20)

        task_service.set_task_status(self.session, user.id, tasks[1].id, "done")
        _, phase_after_three = task_service.set_task_status(
            self.session, user.id, tasks[2].id, "done"
        )
        # 3 of 5 done -> 60.
        self.assertEqual(phase_after_three.progress_percent, 60)

    def test_pending_toggle_recomputes(self) -> None:
        user = self._make_user()
        phase, tasks = self._make_phase_with_tasks(user, 4)
        task_service.set_task_status(self.session, user.id, tasks[0].id, "done")
        task_service.set_task_status(self.session, user.id, tasks[1].id, "done")
        _, phase_half = task_service.set_task_status(
            self.session, user.id, tasks[2].id, "done"
        )
        self.assertEqual(phase_half.progress_percent, 75)

        # Toggle one back to pending: 2 of 4 -> 50.
        _, phase_back = task_service.set_task_status(
            self.session, user.id, tasks[0].id, "pending"
        )
        self.assertEqual(phase_back.progress_percent, 50)

    def test_empty_phase_progress_is_zero(self) -> None:
        # A phase with a single task that flips back and forth still touches
        # only its own ratio; the zero-total contract is exercised via the
        # recompute helper directly.
        user = self._make_user()
        plan = Plan(
            user_id=user.id,
            goal_name="考研",
            start_date=date(2025, 1, 1),
            goal_date=date(2025, 12, 31),
            current_level="零基础",
            daily_minutes=120,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        empty_phase = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="空阶段",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 2, 1),
            progress_percent=42,
        )
        self.session.add(empty_phase)
        self.session.commit()

        task_service.recompute_phase_progress(self.session, empty_phase)
        self.assertEqual(empty_phase.progress_percent, 0)
        self.assertFalse(empty_phase.is_completed)
        self.assertTrue(empty_phase.is_current)

    def test_phase_completes_and_advances_current(self) -> None:
        user = self._make_user()
        plan = Plan(
            user_id=user.id,
            goal_name="考研",
            start_date=date(2025, 1, 1),
            goal_date=date(2025, 12, 31),
            current_level="零基础",
            daily_minutes=120,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        phase_one = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="阶段 1",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 2, 1),
            is_current=True,
        )
        phase_two = Phase(
            plan_id=plan.id,
            phase_index=2,
            name="阶段 2",
            start_date=date(2025, 2, 2),
            end_date=date(2025, 3, 1),
            is_current=False,
        )
        self.session.add_all([phase_one, phase_two])
        self.session.flush()
        tasks = [
            DailyTask(
                plan_id=plan.id,
                phase_id=phase_one.id,
                task_date=date(2025, 1, 1 + i),
                week_label="W01",
                description=f"任务 {i}",
                status="pending",
            )
            for i in range(2)
        ]
        self.session.add_all(tasks)
        self.session.commit()

        task_service.set_task_status(self.session, user.id, tasks[0].id, "done")
        self.session.expire_all()
        self.assertFalse(self.session.get(Phase, phase_one.id).is_completed)
        self.assertTrue(self.session.get(Phase, phase_one.id).is_current)

        _, finished = task_service.set_task_status(
            self.session, user.id, tasks[1].id, "done"
        )
        self.assertEqual(finished.progress_percent, 100)
        self.assertTrue(finished.is_completed)
        self.session.expire_all()
        self.assertFalse(self.session.get(Phase, phase_one.id).is_current)
        self.assertTrue(self.session.get(Phase, phase_two.id).is_current)

        # Reopen one task: stage 1 incomplete again and becomes current.
        _, reopened = task_service.set_task_status(
            self.session, user.id, tasks[0].id, "pending"
        )
        self.assertEqual(reopened.progress_percent, 50)
        self.assertFalse(reopened.is_completed)
        self.assertTrue(reopened.is_current)
        self.session.expire_all()
        self.assertFalse(self.session.get(Phase, phase_two.id).is_current)

    def test_foreign_task_raises_not_found_and_does_not_modify(self) -> None:
        owner = self._make_user("owner")
        intruder = self._make_user("intruder")
        phase, tasks = self._make_phase_with_tasks(owner, 2)

        with self.assertRaises(TaskNotFoundError) as ctx:
            task_service.set_task_status(
                self.session, intruder.id, tasks[0].id, "done"
            )
        self.assertEqual(ctx.exception.code, "NOT_FOUND")

        self.session.expire_all()
        untouched = self.session.scalar(
            select(DailyTask).where(DailyTask.id == tasks[0].id)
        )
        self.assertEqual(untouched.status, "pending")
        refreshed_phase = self.session.scalar(
            select(Phase).where(Phase.id == phase.id)
        )
        self.assertEqual(refreshed_phase.progress_percent, 0)

    def test_unknown_task_raises_not_found(self) -> None:
        user = self._make_user()
        with self.assertRaises(TaskNotFoundError):
            task_service.set_task_status(
                self.session, user.id, uuid.uuid4(), "done"
            )

    def test_invalid_status_raises_validation(self) -> None:
        user = self._make_user()
        phase, tasks = self._make_phase_with_tasks(user, 2)
        with self.assertRaises(TaskStatusValidationError) as ctx:
            task_service.set_task_status(
                self.session, user.id, tasks[0].id, "archived"
            )
        self.assertEqual(ctx.exception.code, "VALIDATION")
        self.session.expire_all()
        untouched = self.session.scalar(
            select(DailyTask).where(DailyTask.id == tasks[0].id)
        )
        self.assertEqual(untouched.status, "pending")


if __name__ == "__main__":
    unittest.main()
