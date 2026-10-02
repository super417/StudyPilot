"""Study property tests: check-in round-trip, metrics, and progress recompute.

Covers task 20.4 — properties 8, 17, 18, 20 and 21. Every property runs against
an in-memory SQLite database and exercises only our own logic: no AI call, no
network. Property 19 (the ring percent, requirement 4.1) is a **frontend** pure
function (`frontend/src/lib/goalProgress.ts`) and is covered by fast-check on
that side, so it is intentionally absent here.

Each property is a separate ``@given`` case at >= 100 iterations, annotated with
the ``Feature: study-pilot, Property N`` marker so it maps back to design.md.
"""

import base64
import os
import unittest
import uuid
from datetime import date, timedelta

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import CheckIn, DailyTask, Phase, Plan, User
from app.services import checkin_service, metrics_service, task_service

# >100 iterations per property, as required by the task.
PROPERTY_SETTINGS = settings(
    max_examples=150,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)

_TODAY = date(2026, 9, 28)


# --- strategies -------------------------------------------------------------

_dates = st.dates(min_value=date(2026, 1, 1), max_value=date(2026, 12, 31))


@st.composite
def _check_in_input(draw):
    """A valid check-in payload: duration > 0, difficulty/energy in [1, 5]."""
    return {
        "check_date": draw(_dates),
        "duration_minutes": draw(st.integers(min_value=1, max_value=600)),
        "difficulty": draw(st.integers(min_value=1, max_value=5)),
        "energy": draw(st.integers(min_value=1, max_value=5)),
        "note": draw(st.one_of(st.none(), st.text(min_size=0, max_size=40))),
    }


@st.composite
def _check_in_date_set(draw):
    """An arbitrary set of check-in dates plus the 'today' to evaluate at."""
    offsets = draw(
        st.lists(
            st.integers(min_value=-30, max_value=30),
            min_size=0,
            max_size=25,
            unique=True,
        )
    )
    return {_TODAY + timedelta(days=offset) for offset in offsets}


@st.composite
def _task_status_sequence(draw):
    """A phase's task count plus an arbitrary pending/done toggle sequence."""
    total = draw(st.integers(min_value=0, max_value=12))
    toggles = draw(
        st.lists(st.booleans(), min_size=1, max_size=20)  # True = mark done
    )
    return total, toggles


class StudyPropertyTests(unittest.TestCase):
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
        Base.metadata.drop_all(cls.engine)
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
        self.user = User(
            username=f"study-{os.urandom(6).hex()}",
            password_hash="x" * 20,
        )
        self.session.add(self.user)
        self.session.commit()

    def tearDown(self) -> None:
        self.session.rollback()
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _reset_user_data(self) -> None:
        """Wipe every row owned by the test user.

        Hypothesis re-runs the property body for each generated example against
        the *same* ``setUp``-created user, so state from a previous example would
        otherwise leak into the next one. ``Phase`` / ``DailyTask`` carry no
        ``user_id``; they are reached through the user's plans.
        """
        plan_ids = list(
            self.session.scalars(select(Plan.id).where(Plan.user_id == self.user.id))
        )
        if plan_ids:
            self.session.query(DailyTask).filter(
                DailyTask.plan_id.in_(plan_ids)
            ).delete(synchronize_session=False)
            self.session.query(Phase).filter(
                Phase.plan_id.in_(plan_ids)
            ).delete(synchronize_session=False)
            self.session.query(Plan).filter(
                Plan.id.in_(plan_ids)
            ).delete(synchronize_session=False)
        self.session.query(CheckIn).filter(
            CheckIn.user_id == self.user.id
        ).delete(synchronize_session=False)
        self.session.commit()

    def _seed_plan(self, phase_count: int = 2, goal_date: date | None = None) -> Plan:
        plan = Plan(
            user_id=self.user.id,
            goal_name="考研数学",
            start_date=_TODAY,
            goal_date=goal_date or (_TODAY + timedelta(days=90)),
            current_level="零基础",
            daily_minutes=120,
            total_phases=phase_count,
        )
        self.session.add(plan)
        self.session.commit()
        return plan

    def _seed_phase(
        self, plan: Plan, phase_index: int = 1, completed: bool = False
    ) -> Phase:
        phase = Phase(
            plan_id=plan.id,
            phase_index=phase_index,
            name=f"阶段 {phase_index}",
            start_date=_TODAY,
            end_date=_TODAY + timedelta(days=30),
            is_completed=completed,
        )
        self.session.add(phase)
        self.session.commit()
        return phase

    def _seed_task(self, plan: Plan, phase: Phase, status: str = "pending") -> DailyTask:
        task = DailyTask(
            plan_id=plan.id,
            phase_id=phase.id,
            task_date=_TODAY,
            week_label="W39",
            description="任务",
            status=status,
        )
        self.session.add(task)
        self.session.commit()
        return task

    # --- Property 8 ---------------------------------------------------------

    @PROPERTY_SETTINGS
    @given(payload=_check_in_input())
    def test_property_8_check_in_round_trip(self, payload: dict) -> None:
        """Feature: study-pilot, Property 8: 打卡数据往返一致.

        Validates: Requirements 4.7, 11.3

        For any valid check-in input, every field read back from Check_Ins
        equals the value that was written — nothing is silently coerced,
        truncated, or defaulted.
        """
        self._reset_user_data()

        created = checkin_service.create_check_in(
            self.session,
            self.user.id,
            payload["check_date"],
            payload["duration_minutes"],
            payload["difficulty"],
            payload["energy"],
            payload["note"],
        )

        self.session.expire_all()
        stored = self.session.get(CheckIn, created.id)
        self.assertIsNotNone(stored)
        self.assertEqual(stored.user_id, self.user.id)
        self.assertEqual(stored.check_date, payload["check_date"])
        self.assertEqual(stored.duration_minutes, payload["duration_minutes"])
        self.assertEqual(stored.difficulty, payload["difficulty"])
        self.assertEqual(stored.energy, payload["energy"])
        self.assertEqual(stored.note, payload["note"])

    @PROPERTY_SETTINGS
    @given(
        duration=st.integers(min_value=-50, max_value=0),
        difficulty=st.integers(min_value=1, max_value=5),
        energy=st.integers(min_value=1, max_value=5),
    )
    def test_property_8_invalid_duration_writes_nothing(
        self, duration: int, difficulty: int, energy: int
    ) -> None:
        """Feature: study-pilot, Property 8: 打卡数据往返一致（写入原子性）.

        Validates: Requirements 4.7, 11.3

        A rejected check-in leaves the table exactly as it was, so an invalid
        submission can never create a partial or bogus record.
        """
        self._reset_user_data()
        with self.assertRaises(checkin_service.CheckInValidationError):
            checkin_service.create_check_in(
                self.session,
                self.user.id,
                _TODAY,
                duration,
                difficulty,
                energy,
            )
        self.session.rollback()
        self.assertEqual(
            self.session.scalar(
                select(func.count())
                .select_from(CheckIn)
                .where(CheckIn.user_id == self.user.id)
            ),
            0,
        )

    # --- Property 17 --------------------------------------------------------

    @PROPERTY_SETTINGS
    @given(dates=_check_in_date_set(), today=_dates)
    def test_property_17_streak_breaks_at_first_gap(
        self, dates: set[date], today: date
    ) -> None:
        """Feature: study-pilot, Property 17: 连续打卡天数在首个缺口处中断.

        Validates: Requirements 15.3

        The walk-back counts consecutive checked-in days and stops at the first
        gap: the day immediately before the counted window is never checked in,
        and no future date is ever allowed to seed the count.
        """
        streak = metrics_service.compute_streak(dates, today)

        if not dates:
            self.assertEqual(streak, 0)
            return

        past = {d for d in dates if d <= today}
        if not past:
            # Every check-in is in the future: nothing to walk back from.
            self.assertEqual(streak, 0)
            return

        # Only days on or before ``today`` may contribute, and if today itself
        # is not a check-in day the window must end at the latest past day.
        self.assertLessEqual(streak, len(past))
        expected_start = today if today in dates else max(past)

        # Property: streak == the number of consecutive days ending at
        # expected_start; the day before that window is NOT checked in.
        expected = 0
        cursor = expected_start
        while cursor in dates:
            expected += 1
            cursor -= timedelta(days=1)
        self.assertEqual(streak, expected)
        self.assertNotIn(cursor, dates, "the streak must break at the first gap")

    # --- Property 18 --------------------------------------------------------

    @PROPERTY_SETTINGS
    @given(
        durations=st.lists(st.integers(min_value=1, max_value=300), max_size=15),
        goal_offset=st.integers(min_value=-60, max_value=180),
        today_offset=st.integers(min_value=-90, max_value=90),
        phase_count=st.integers(min_value=2, max_value=12),
        completed_count=st.integers(min_value=0, max_value=12),
    )
    def test_property_18_totals_and_scales_agree(
        self,
        durations: list[int],
        goal_offset: int,
        today_offset: int,
        phase_count: int,
        completed_count: int,
    ) -> None:
        """Feature: study-pilot, Property 18: 累计分钟等于求和、剩余天数与阶段进度口径一致.

        Validates: Requirements 15.1, 15.4, 15.5

        total minutes is exactly SUM(duration_minutes); remaining days is exactly
        max(0, goal_date - today) and never negative; phase progress numerator is
        the count of completed phases and the denominator the total phase count.
        """
        self._reset_user_data()

        today = _TODAY + timedelta(days=today_offset)
        goal_date = _TODAY + timedelta(days=goal_offset)
        plan = self._seed_plan(phase_count=phase_count, goal_date=goal_date)

        completed = completed_count % (phase_count + 1)
        for index in range(phase_count):
            self._seed_phase(
                plan, phase_index=index + 1, completed=index < completed
            )

        for duration in durations:
            checkin_service.create_check_in(
                self.session, self.user.id, today, duration, 3, 3
            )

        metrics = metrics_service.compute_overview(self.session, self.user.id, today)

        self.assertEqual(metrics.total_minutes, sum(durations))
        self.assertEqual(metrics.remaining_days, max(0, (goal_date - today).days))
        self.assertGreaterEqual(metrics.remaining_days, 0)
        self.assertEqual(metrics.phase_progress_completed, completed)
        self.assertEqual(metrics.phase_progress_total, phase_count)

    # --- Property 20 --------------------------------------------------------

    @PROPERTY_SETTINGS
    @given(case=_task_status_sequence())
    def test_property_20_phase_progress_recompute(
        self, case: tuple[int, list[bool]]
    ) -> None:
        """Feature: study-pilot, Property 20: Phase 进度重算正确性.

        Validates: Requirements 16.2

        After any pending<->done toggle sequence, the phase progress equals
        round(done / total * 100) — and an empty phase is defined as 0.
        """
        self._reset_user_data()

        total, toggles = case
        plan = self._seed_plan(phase_count=2)
        phase = self._seed_phase(plan, phase_index=1)
        tasks = [self._seed_task(plan, phase) for _ in range(total)]

        if total == 0:
            task_service.recompute_phase_progress(self.session, phase)
            self.session.commit()
            self.session.expire_all()
            self.assertEqual(self.session.get(Phase, phase.id).progress_percent, 0)
            return

        for index, mark_done in enumerate(toggles):
            target = tasks[index % total]
            task_service.set_task_status(
                self.session,
                self.user.id,
                target.id,
                "done" if mark_done else "pending",
            )

            self.session.expire_all()
            done_count = self.session.scalar(
                select(func.count())
                .select_from(DailyTask)
                .where(DailyTask.phase_id == phase.id, DailyTask.status == "done")
            )
            refreshed = self.session.get(Phase, phase.id)
            self.assertEqual(
                refreshed.progress_percent,
                round(done_count / total * 100),
                "progress must always equal round(done/total*100)",
            )
            self.assertGreaterEqual(refreshed.progress_percent, 0)
            self.assertLessEqual(refreshed.progress_percent, 100)

    # --- Property 21 --------------------------------------------------------

    @PROPERTY_SETTINGS
    @given(has_task=st.booleans(), has_checkin=st.booleans())
    def test_property_21_today_three_state_mapping(
        self, has_task: bool, has_checkin: bool
    ) -> None:
        """Feature: study-pilot, Property 21: 今日任务三态判定映射正确.

        Validates: Requirements 16.3

        Every combination of "task today" and "check-in today" maps to the right
        label — including a check-in without a task, which stays 未反馈 because
        the state is anchored on whether the day was scheduled.
        """
        self._reset_user_data()

        if has_task:
            plan = self._seed_plan(phase_count=2)
            phase = self._seed_phase(plan, phase_index=1)
            self._seed_task(plan, phase)

        if has_checkin:
            checkin_service.create_check_in(
                self.session, self.user.id, _TODAY, 45, 3, 3
            )

        # The pure classifier and the DB-backed path must agree.
        self.assertEqual(
            metrics_service.classify_today(has_task, has_checkin),
            metrics_service.compute_overview(
                self.session, self.user.id, _TODAY
            ).today_status,
        )

        expected = {
            (False, False): metrics_service.TODAY_STATUS_NO_TASK,
            (False, True): metrics_service.TODAY_STATUS_NO_TASK,
            (True, False): metrics_service.TODAY_STATUS_SCHEDULED,
            (True, True): metrics_service.TODAY_STATUS_COMPLETED,
        }[(has_task, has_checkin)]
        self.assertEqual(
            metrics_service.compute_overview(
                self.session, self.user.id, _TODAY
            ).today_status,
            expected,
        )


if __name__ == "__main__":
    unittest.main()
