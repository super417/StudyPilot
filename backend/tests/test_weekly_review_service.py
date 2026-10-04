import base64
import os
import unittest
from datetime import date, datetime, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import (
    CheckIn,
    Course,
    DailyTask,
    Phase,
    Plan,
    User,
    WeeklyReview,
)
from app.services import weekly_review_service


class WeekBoundsTests(unittest.TestCase):
    """Pure-function tests — no database required."""

    def test_mid_week_wednesday(self) -> None:
        # 2025-02-12 is a Wednesday.
        start, end = weekly_review_service.week_bounds(date(2025, 2, 12))
        self.assertEqual(start, date(2025, 2, 10))  # Monday
        self.assertEqual(end, date(2025, 2, 16))  # Sunday

    def test_monday_maps_to_itself(self) -> None:
        start, end = weekly_review_service.week_bounds(date(2025, 2, 10))
        self.assertEqual(start, date(2025, 2, 10))
        self.assertEqual(end, date(2025, 2, 16))

    def test_sunday_maps_to_week(self) -> None:
        start, end = weekly_review_service.week_bounds(date(2025, 2, 16))
        self.assertEqual(start, date(2025, 2, 10))
        self.assertEqual(end, date(2025, 2, 16))

    def test_month_crossing_week(self) -> None:
        # 2025-04-01 is a Tuesday; its week starts 2025-03-31.
        start, end = weekly_review_service.week_bounds(date(2025, 4, 1))
        self.assertEqual(start, date(2025, 3, 31))
        self.assertEqual(end, date(2025, 4, 6))

    def test_year_crossing_week(self) -> None:
        # 2025-01-01 is a Wednesday; its week starts 2024-12-30.
        start, end = weekly_review_service.week_bounds(date(2025, 1, 1))
        self.assertEqual(start, date(2024, 12, 30))
        self.assertEqual(end, date(2025, 1, 5))

    def test_completion_rate(self) -> None:
        self.assertEqual(weekly_review_service.completion_rate(0, 0), 0)
        self.assertEqual(weekly_review_service.completion_rate(0, 4), 0)
        self.assertEqual(weekly_review_service.completion_rate(2, 4), 50)
        self.assertEqual(weekly_review_service.completion_rate(3, 3), 100)
        self.assertEqual(weekly_review_service.completion_rate(1, 3), 33)


class WeeklyReviewServiceTests(unittest.TestCase):
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
        # Fixed natural week: Mon 2025-02-10 .. Sun 2025-02-16.
        self.week_start = date(2025, 2, 10)
        self.week_end = date(2025, 2, 16)

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _make_user(self, name: str = "user") -> User:
        user = User(username=f"{name}-{os.urandom(4).hex()}", password_hash="x")
        self.session.add(user)
        self.session.commit()
        return user

    def _add_check_in(
        self, user: User, check_date: date, minutes: int = 60
    ) -> None:
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

    def _make_plan_with_phase(self, user: User) -> tuple[Plan, Phase]:
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
            end_date=date(2025, 3, 1),
        )
        self.session.add(phase)
        self.session.commit()
        return plan, phase

    def _add_task(
        self, plan: Plan, phase: Phase, task_date: date, status: str = "pending"
    ) -> None:
        self.session.add(
            DailyTask(
                plan_id=plan.id,
                phase_id=phase.id,
                task_date=task_date,
                week_label="W07",
                description="任务",
                status=status,
            )
        )
        self.session.commit()

    # --- generation ---------------------------------------------------------

    def test_no_check_in_returns_none_and_writes_nothing(self) -> None:
        user = self._make_user()
        review = weekly_review_service.generate_weekly_review(
            self.session, user.id, self.week_start, self.week_end
        )
        self.assertIsNone(review)
        rows = list(self.session.scalars(select(WeeklyReview)))
        self.assertEqual(rows, [])

    def test_generates_and_sums_total_minutes(self) -> None:
        user = self._make_user()
        self._add_check_in(user, date(2025, 2, 10), 60)
        self._add_check_in(user, date(2025, 2, 11), 90)
        # Out-of-week check-in must not count.
        self._add_check_in(user, date(2025, 2, 17), 999)

        review = weekly_review_service.generate_weekly_review(
            self.session, user.id, self.week_start, self.week_end
        )
        self.assertIsNotNone(review)
        self.assertEqual(review.total_minutes, 150)

    def test_completion_rate_reflects_week_tasks(self) -> None:
        user = self._make_user()
        self._add_check_in(user, date(2025, 2, 10), 60)
        plan, phase = self._make_plan_with_phase(user)
        self._add_task(plan, phase, date(2025, 2, 10), "done")
        self._add_task(plan, phase, date(2025, 2, 11), "done")
        self._add_task(plan, phase, date(2025, 2, 12), "pending")
        self._add_task(plan, phase, date(2025, 2, 13), "pending")
        # Out-of-week task must not count.
        self._add_task(plan, phase, date(2025, 2, 20), "done")

        review = weekly_review_service.generate_weekly_review(
            self.session, user.id, self.week_start, self.week_end
        )
        # 2 done of 4 in-week -> 50.
        self.assertEqual(review.completion_rate, 50)

    def test_mastery_uses_course_task_completion(self) -> None:
        user = self._make_user()
        self._add_check_in(user, date(2025, 2, 10), 60)
        plan, phase = self._make_plan_with_phase(user)
        phase.name = "高等数学强化"
        self.session.add_all(
            [
                Course(user_id=user.id, name="高等数学", status="active"),
                Course(user_id=user.id, name="英语", status="active"),
            ]
        )
        self.session.commit()
        self._add_task(plan, phase, date(2025, 2, 10), "done")
        self._add_task(plan, phase, date(2025, 2, 11), "pending")
        self._add_task(plan, phase, date(2025, 2, 20), "done")

        review = weekly_review_service.generate_weekly_review(
            self.session, user.id, self.week_start, self.week_end
        )
        self.assertEqual(
            review.mastery_detail,
            [
                {"subject": "英语", "percent": 0},
                {"subject": "高等数学", "percent": 50},
            ],
        )
        self.assertEqual(review.mastery_avg, 25)

    def test_repeat_call_is_idempotent(self) -> None:
        user = self._make_user()
        self._add_check_in(user, date(2025, 2, 10), 60)
        first = weekly_review_service.generate_weekly_review(
            self.session, user.id, self.week_start, self.week_end
        )
        second = weekly_review_service.generate_weekly_review(
            self.session, user.id, self.week_start, self.week_end
        )
        self.assertEqual(first.id, second.id)
        rows = list(self.session.scalars(select(WeeklyReview)))
        self.assertEqual(len(rows), 1)

    def test_run_weekly_generation_scans_previous_week(self) -> None:
        # now in the week after our fixed week -> previous week is the fixed one.
        now = datetime(2025, 2, 19, 12, 0, tzinfo=timezone.utc)  # Wed next week
        active = self._make_user("active")
        idle = self._make_user("idle")
        self._add_check_in(active, date(2025, 2, 11), 45)

        reviews = weekly_review_service.run_weekly_generation(self.session, now=now)
        self.assertEqual(len(reviews), 1)
        self.assertEqual(reviews[0].user_id, active.id)
        self.assertEqual(reviews[0].week_start, self.week_start)
        self.assertEqual(reviews[0].week_end, self.week_end)
        # Idle user got nothing.
        idle_rows = list(
            self.session.scalars(
                select(WeeklyReview).where(WeeklyReview.user_id == idle.id)
            )
        )
        self.assertEqual(idle_rows, [])

    # --- get_latest ---------------------------------------------------------

    def test_get_latest_returns_none_when_empty(self) -> None:
        user = self._make_user()
        self.assertIsNone(
            weekly_review_service.get_latest_weekly_review(self.session, user.id)
        )

    def test_get_latest_returns_most_recent_week(self) -> None:
        user = self._make_user()
        older = WeeklyReview(
            user_id=user.id,
            week_start=date(2025, 2, 3),
            week_end=date(2025, 2, 9),
            total_minutes=100,
            streak_days=1,
            completion_rate=0,
            mastery_avg=0,
            mastery_detail={},
        )
        newer = WeeklyReview(
            user_id=user.id,
            week_start=self.week_start,
            week_end=self.week_end,
            total_minutes=200,
            streak_days=2,
            completion_rate=0,
            mastery_avg=0,
            mastery_detail={},
        )
        self.session.add_all([older, newer])
        self.session.commit()

        latest = weekly_review_service.get_latest_weekly_review(
            self.session, user.id
        )
        self.assertEqual(latest.week_end, self.week_end)

    def test_get_latest_scopes_to_user(self) -> None:
        mine = self._make_user("mine")
        other = self._make_user("other")
        self.session.add(
            WeeklyReview(
                user_id=other.id,
                week_start=self.week_start,
                week_end=self.week_end,
                total_minutes=200,
                streak_days=2,
                completion_rate=0,
                mastery_avg=0,
                mastery_detail={},
            )
        )
        self.session.commit()
        self.assertIsNone(
            weekly_review_service.get_latest_weekly_review(self.session, mine.id)
        )


if __name__ == "__main__":
    unittest.main()
