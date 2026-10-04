import os
import unittest
from datetime import date

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.models.base import Base
from app.models.entities import DailyTask, Phase, Plan, User
from app.services.planner_service import anchor_plan_to
from app.services.video_link import parse_start_date


class AnchorPlanStartTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._environment = {
            name: os.environ.get(name) for name in ("DATABASE_URL", "DB_PASSWORD")
        }
        os.environ["DATABASE_URL"] = "sqlite:///:memory:"
        os.environ["DB_PASSWORD"] = "temporary-test-password"
        get_settings.cache_clear()
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

    def _plan_with_phases(
        self,
        spans: list[tuple[date, date]],
        goal: date = date(2026, 12, 31),
    ) -> tuple[Plan, list[Phase]]:
        user = User(username=f"u-{os.urandom(3).hex()}", password_hash="x" * 8)
        self.session.add(user)
        self.session.flush()
        plan = Plan(
            user_id=user.id,
            goal_name="数学二",
            start_date=spans[0][0],
            goal_date=goal,
            current_level="基础",
            daily_minutes=120,
            total_phases=max(len(spans), 2),
        )
        self.session.add(plan)
        self.session.flush()
        phases = []
        for index, (phase_start, phase_end) in enumerate(spans, start=1):
            phase = Phase(
                plan_id=plan.id,
                phase_index=index,
                name=f"阶段{index}",
                start_date=phase_start,
                end_date=phase_end,
                is_current=index == 1,
            )
            self.session.add(phase)
            phases.append(phase)
        self.session.commit()
        return plan, phases

    def test_a_schedule_that_fits_slides_with_its_gaps_intact(self) -> None:
        plan, phases = self._plan_with_phases(
            [
                (date(2026, 5, 7), date(2026, 5, 20)),
                (date(2026, 5, 25), date(2026, 6, 1)),
            ]
        )
        anchor_plan_to(self.session, plan, date(2026, 5, 1))
        self.session.commit()
        self.assertEqual(phases[0].start_date, date(2026, 5, 1))
        self.assertEqual(phases[0].end_date, date(2026, 5, 14))
        self.assertEqual(phases[1].start_date, date(2026, 5, 19))
        self.assertEqual(phases[1].end_date, date(2026, 5, 26))

    def test_a_schedule_that_does_not_fit_is_compressed_not_piled_up(self) -> None:
        """Regression: six phases used to collapse onto the goal date."""
        plan, phases = self._plan_with_phases(
            [
                (date(2026, 5, 7), date(2026, 6, 15)),
                (date(2026, 6, 16), date(2026, 8, 10)),
                (date(2026, 8, 11), date(2026, 9, 30)),
                (date(2026, 10, 1), date(2026, 11, 15)),
                (date(2026, 11, 16), date(2026, 12, 20)),
                (date(2026, 12, 21), date(2026, 12, 31)),
            ]
        )
        start = date(2026, 10, 6)
        goal = date(2026, 12, 31)
        anchor_plan_to(self.session, plan, start)
        self.session.commit()
        self.assertEqual(phases[0].start_date, start)
        self.assertEqual(phases[-1].end_date, goal)
        for phase in phases:
            self.assertLessEqual(phase.start_date, phase.end_date)
            self.assertGreaterEqual(phase.start_date, start)
            self.assertLessEqual(phase.end_date, goal)
        starts = [phase.start_date for phase in phases]
        self.assertEqual(starts, sorted(starts))
        spans = {(phase.start_date, phase.end_date) for phase in phases}
        self.assertEqual(len(spans), len(phases))

    def test_user_date_becomes_the_first_day(self) -> None:
        user = User(username=f"u-{os.urandom(3).hex()}", password_hash="x" * 8)
        self.session.add(user)
        self.session.flush()
        plan = Plan(
            user_id=user.id,
            goal_name="数学二",
            start_date=date(2026, 10, 4),
            goal_date=date(2026, 12, 31),
            current_level="基础",
            daily_minutes=120,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        phase = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="基础",
            start_date=date(2026, 5, 7),
            end_date=date(2026, 6, 15),
            is_current=True,
        )
        self.session.add(phase)
        self.session.flush()
        self.session.add(
            DailyTask(
                plan_id=plan.id,
                phase_id=phase.id,
                task_date=date(2026, 5, 7),
                week_label="W19",
                description="诊断",
                status="pending",
            )
        )
        self.session.commit()
        start = parse_start_date("10月8日", date(2026, 10, 4))
        assert start is not None
        anchor_plan_to(self.session, plan, start)
        self.session.commit()
        self.assertEqual(plan.start_date, date(2026, 10, 8))
        self.assertEqual(phase.start_date, date(2026, 10, 8))
        task = self.session.scalar(select(DailyTask))
        assert task is not None
        self.assertEqual(task.task_date, date(2026, 10, 8))
