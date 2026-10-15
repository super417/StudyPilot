"""One plan has exactly one current phase after the computed writer runs."""

import base64
import os
import unittest
from datetime import date

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import DailyTask, Phase, Plan, User
from app.services import task_service


class PhaseCurrentInvariantTests(unittest.TestCase):
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

    def _current_indexes(self, plan_id) -> list[int]:
        phases = list(
            self.session.scalars(
                select(Phase).where(Phase.plan_id == plan_id).order_by(Phase.phase_index)
            )
        )
        return [phase.phase_index for phase in phases if phase.is_current]

    def test_one_plan_keeps_exactly_one_current_phase(self) -> None:
        user = User(username=f"user-{os.urandom(4).hex()}", password_hash="x")
        self.session.add(user)
        self.session.flush()
        plan = Plan(
            user_id=user.id,
            goal_name="考研",
            start_date=date(2025, 1, 1),
            goal_date=date(2025, 12, 31),
            current_level="零基础",
            daily_minutes=120,
            total_phases=3,
        )
        self.session.add(plan)
        self.session.flush()
        phases: list[Phase] = []
        for index in range(1, 4):
            phase = Phase(
                plan_id=plan.id,
                phase_index=index,
                name=f"阶段 {index}",
                start_date=date(2025, index, 1),
                end_date=date(2025, index, 28),
                is_current=index < 3,
            )
            self.session.add(phase)
            self.session.flush()
            task = DailyTask(
                plan_id=plan.id,
                phase_id=phase.id,
                task_date=date(2025, index, 2),
                week_label="W01",
                description=f"任务 {index}",
                status="pending",
            )
            self.session.add(task)
            phases.append(phase)
        self.session.commit()

        task_service.sync_plan_current_phase(self.session, plan.id)
        self.session.expire_all()
        self.assertEqual(self._current_indexes(plan.id), [1])

        first_task = self.session.scalar(
            select(DailyTask).where(DailyTask.phase_id == phases[0].id)
        )
        task_service.set_task_status(self.session, user.id, first_task.id, "done")
        self.session.expire_all()
        self.assertEqual(self._current_indexes(plan.id), [2])

        for phase in phases[1:]:
            task = self.session.scalar(
                select(DailyTask).where(DailyTask.phase_id == phase.id)
            )
            task_service.set_task_status(self.session, user.id, task.id, "done")
        self.session.expire_all()
        self.assertEqual(self._current_indexes(plan.id), [3])
