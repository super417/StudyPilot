import base64
import os
import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import CheckIn, DailyTask, Phase, Plan, User
from app.services import metrics_service
from app.services.metrics_service import classify_today, compute_streak


class ComputeStreakTests(unittest.TestCase):
    def test_empty_set_is_zero(self) -> None:
        self.assertEqual(compute_streak(set(), date(2025, 2, 10)), 0)

    def test_today_checked_in_counts_consecutive(self) -> None:
        days = {date(2025, 2, 8), date(2025, 2, 9), date(2025, 2, 10)}
        self.assertEqual(compute_streak(days, date(2025, 2, 10)), 3)

    def test_today_not_checked_in_walks_back_from_latest(self) -> None:
        # today is the 12th, no check-in that day; latest run ends on the 10th.
        days = {date(2025, 2, 9), date(2025, 2, 10)}
        self.assertEqual(compute_streak(days, date(2025, 2, 12)), 2)

    def test_gap_breaks_the_streak(self) -> None:
        # Missing the 9th: only the 10th counts from today.
        days = {date(2025, 2, 7), date(2025, 2, 8), date(2025, 2, 10)}
        self.assertEqual(compute_streak(days, date(2025, 2, 10)), 1)

    def test_future_only_check_ins_do_not_seed(self) -> None:
        # All check-ins are after today -> no walk-back start on or before today.
        days = {date(2025, 2, 20), date(2025, 2, 21)}
        self.assertEqual(compute_streak(days, date(2025, 2, 10)), 0)


class ClassifyTodayTests(unittest.TestCase):
    def test_no_task_is_no_feedback(self) -> None:
        self.assertEqual(classify_today(False, False), "未反馈")
        self.assertEqual(classify_today(False, True), "未反馈")

    def test_task_without_checkin_is_scheduled(self) -> None:
        self.assertEqual(classify_today(True, False), "已安排")

    def test_task_with_checkin_is_completed(self) -> None:
        self.assertEqual(classify_today(True, True), "已完成")


class ComputeOverviewTests(unittest.TestCase):
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

    def _add_check_in(self, user: User, check_date: date, minutes: int) -> None:
        self.session.add(
            CheckIn(
                user_id=user.id,
                check_date=check_date,
                duration_minutes=minutes,
                difficulty=3,
                energy=3,
            )
        )
        self.session.commit()

    def _add_plan(
        self, user: User, goal_date: date, total_phases: int, completed: int
    ) -> Plan:
        plan = Plan(
            user_id=user.id,
            goal_name="考研",
            start_date=date(2025, 1, 1),
            goal_date=goal_date,
            current_level="零基础",
            daily_minutes=120,
            total_phases=total_phases,
        )
        self.session.add(plan)
        self.session.flush()
        for i in range(total_phases):
            self.session.add(
                Phase(
                    plan_id=plan.id,
                    phase_index=i + 1,
                    name=f"阶段 {i + 1}",
                    start_date=date(2025, 1, 1),
                    end_date=date(2025, 2, 1),
                    is_completed=(i < completed),
                )
            )
        self.session.commit()
        return plan

    def test_total_minutes_sums_only_own_check_ins(self) -> None:
        user = self._make_user("mine")
        other = self._make_user("other")
        self._add_check_in(user, date(2025, 2, 8), 60)
        self._add_check_in(user, date(2025, 2, 9), 90)
        self._add_check_in(other, date(2025, 2, 9), 999)

        metrics = metrics_service.compute_overview(
            self.session, user.id, date(2025, 2, 9)
        )
        self.assertEqual(metrics.total_minutes, 150)
        self.assertEqual(metrics.streak_days, 2)

    def test_remaining_days_and_phase_progress(self) -> None:
        user = self._make_user()
        self._add_plan(user, date(2025, 2, 20), total_phases=7, completed=2)
        metrics = metrics_service.compute_overview(
            self.session, user.id, date(2025, 2, 10)
        )
        self.assertEqual(metrics.remaining_days, 10)
        self.assertEqual(metrics.phase_progress_completed, 2)
        self.assertEqual(metrics.phase_progress_total, 7)

    def test_past_goal_date_gives_zero_remaining(self) -> None:
        user = self._make_user()
        self._add_plan(user, date(2025, 1, 1), total_phases=3, completed=0)
        metrics = metrics_service.compute_overview(
            self.session, user.id, date(2025, 2, 10)
        )
        self.assertEqual(metrics.remaining_days, 0)

    def test_no_plan_yields_zero_progress_and_remaining(self) -> None:
        user = self._make_user()
        metrics = metrics_service.compute_overview(
            self.session, user.id, date(2025, 2, 10)
        )
        self.assertEqual(metrics.remaining_days, 0)
        self.assertEqual(metrics.phase_progress_completed, 0)
        self.assertEqual(metrics.phase_progress_total, 0)

    def test_latest_plan_used_for_progress(self) -> None:
        user = self._make_user()
        self._add_plan(user, date(2025, 3, 1), total_phases=3, completed=1)
        latest = self._add_plan(user, date(2025, 4, 1), total_phases=8, completed=4)
        metrics = metrics_service.compute_overview(
            self.session, user.id, date(2025, 2, 10)
        )
        self.assertEqual(metrics.phase_progress_total, latest.total_phases)
        self.assertEqual(metrics.phase_progress_completed, 4)

    def test_today_status_no_task(self) -> None:
        user = self._make_user()
        metrics = metrics_service.compute_overview(
            self.session, user.id, date(2025, 2, 10)
        )
        self.assertEqual(metrics.today_status, "未反馈")

    def test_today_status_scheduled_then_completed(self) -> None:
        user = self._make_user()
        plan = self._add_plan(user, date(2025, 4, 1), total_phases=2, completed=0)
        phase = self.session.query(Phase).filter(Phase.plan_id == plan.id).first()
        self.session.add(
            DailyTask(
                plan_id=plan.id,
                phase_id=phase.id,
                task_date=date(2025, 2, 10),
                week_label="W01",
                description="今日任务",
                status="pending",
            )
        )
        self.session.commit()

        scheduled = metrics_service.compute_overview(
            self.session, user.id, date(2025, 2, 10)
        )
        self.assertEqual(scheduled.today_status, "已安排")

        self._add_check_in(user, date(2025, 2, 10), 60)
        completed = metrics_service.compute_overview(
            self.session, user.id, date(2025, 2, 10)
        )
        self.assertEqual(completed.today_status, "已完成")


if __name__ == "__main__":
    unittest.main()
