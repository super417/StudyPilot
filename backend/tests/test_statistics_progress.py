"""Batch 16: stars / route / overdue / today-task fields on statistics overview."""

from __future__ import annotations

import base64
import os
import unittest
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.clock import CHINA_TZ, local_today
from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import (
    DailyTask,
    MasteryEvidence,
    Phase,
    Plan,
    PlanAdjustment,
    User,
)
from app.routers.statistics import _star_label, build_overview
from app.services import remedy_service


class StarLabelUnitTests(unittest.TestCase):
    def test_star_boundaries(self) -> None:
        cases = [
            (0, None, "none"),
            (1, 100, "gold"),
            (1, 60, "gold"),
            (1, 59, "blue"),
            (1, 40, "blue"),
            (1, 39, "gray"),
        ]
        for answered, accuracy, expected in cases:
            with self.subTest(answered=answered, accuracy=accuracy):
                self.assertEqual(_star_label(answered, accuracy), expected)


class StatisticsProgressTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._environment = {
            name: os.environ.get(name)
            for name in (
                "DATABASE_URL",
                "DB_PASSWORD",
                "AES_KEY",
                "SESSION_TIMEOUT_MINUTES",
            )
        }
        os.environ["DATABASE_URL"] = "sqlite:///:memory:"
        os.environ["DB_PASSWORD"] = "temporary-test-password"
        os.environ["AES_KEY"] = base64.b64encode(bytes(range(32))).decode("ascii")
        os.environ["SESSION_TIMEOUT_MINUTES"] = "30"
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
        self.user = User(username=f"stat-{os.urandom(6).hex()}", password_hash="x" * 20)
        self.session.add(self.user)
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _local_noon(self, day) -> datetime:
        return datetime(day.year, day.month, day.day, 12, 0, tzinfo=CHINA_TZ)

    def _add_evidence(self, day, result: str, evidence_type: str = "quiz") -> None:
        row = MasteryEvidence(
            user_id=self.user.id,
            knowledge_point=None,
            evidence_type=evidence_type,
            result=result,
            answer_text="a",
            grade_reason="r",
            source_ref=None,
            question_id=None,
            created_at=self._local_noon(day).astimezone(timezone.utc),
        )
        self.session.add(row)

    def _plan_with_phase(self) -> tuple[Plan, Phase]:
        today = local_today()
        plan = Plan(
            user_id=self.user.id,
            goal_name="进度计划",
            start_date=today - timedelta(days=10),
            goal_date=today + timedelta(days=60),
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
            start_date=today - timedelta(days=10),
            end_date=today + timedelta(days=10),
            is_current=True,
        )
        self.session.add(phase)
        self.session.flush()
        return plan, phase

    def test_partial_lands_blue(self) -> None:
        today = local_today()
        self._add_evidence(today, "partial")
        self.session.commit()
        overview = build_overview(self.session, self.user.id)
        today_star = next(item for item in overview["stars"] if item["date"] == today.isoformat())
        self.assertEqual(today_star["answered"], 1)
        self.assertEqual(today_star["accuracy"], 50)
        self.assertEqual(today_star["star"], "blue")

    def test_none_days_have_null_accuracy_and_do_not_bleed(self) -> None:
        today = local_today()
        target = today - timedelta(days=2)
        self._add_evidence(target, "correct")
        self._add_evidence(target, "correct")
        self.session.commit()
        overview = build_overview(self.session, self.user.id)
        by_date = {item["date"]: item for item in overview["stars"]}
        self.assertEqual(by_date[target.isoformat()]["accuracy"], 100)
        self.assertEqual(by_date[target.isoformat()]["star"], "gold")
        empty = today - timedelta(days=1)
        self.assertIsNone(by_date[empty.isoformat()]["accuracy"])
        self.assertEqual(by_date[empty.isoformat()]["star"], "none")
        self.assertEqual(by_date[empty.isoformat()]["answered"], 0)

    def test_star_score_boundaries_via_evidence(self) -> None:
        today = local_today()
        # 60 → gold: three correct + two wrong? 300/5=60
        day_gold = today - timedelta(days=5)
        for _ in range(3):
            self._add_evidence(day_gold, "correct")
        for _ in range(2):
            self._add_evidence(day_gold, "wrong")
        # 59 → blue: need round to 59. e.g. scores avg. Use mix: 2 correct + 2 wrong + 1 partial = (200+0+50)/5=50
        # For 59: 59/100 — one way: 100,100,100,100,0,0,13? simpler: plant accuracy by known scores
        # 59 = round(sum/n). Use n=100 with 59 correct → too many. Use: 1 partial + many?
        # (100*3 + 0*2) / 5 = 60 already. For 59: (100*17 + 0*12)/29 = 1700/29≈58.62→59
        day_blue59 = today - timedelta(days=6)
        for _ in range(17):
            self._add_evidence(day_blue59, "correct")
        for _ in range(12):
            self._add_evidence(day_blue59, "wrong")
        # 40 → blue: two partial = 50; for 40: 2 correct + 3 wrong = 200/5=40
        day_blue40 = today - timedelta(days=7)
        for _ in range(2):
            self._add_evidence(day_blue40, "correct")
        for _ in range(3):
            self._add_evidence(day_blue40, "wrong")
        # 39 → gray: 200/5. something → (100*11 + 0*17)/28 = 1100/28≈39.29→39
        day_gray = today - timedelta(days=8)
        for _ in range(11):
            self._add_evidence(day_gray, "correct")
        for _ in range(17):
            self._add_evidence(day_gray, "wrong")
        self.session.commit()
        overview = build_overview(self.session, self.user.id)
        by_date = {item["date"]: item for item in overview["stars"]}
        self.assertEqual(by_date[day_gold.isoformat()]["accuracy"], 60)
        self.assertEqual(by_date[day_gold.isoformat()]["star"], "gold")
        self.assertEqual(by_date[day_blue59.isoformat()]["accuracy"], 59)
        self.assertEqual(by_date[day_blue59.isoformat()]["star"], "blue")
        self.assertEqual(by_date[day_blue40.isoformat()]["accuracy"], 40)
        self.assertEqual(by_date[day_blue40.isoformat()]["star"], "blue")
        self.assertEqual(by_date[day_gray.isoformat()]["accuracy"], 39)
        self.assertEqual(by_date[day_gray.isoformat()]["star"], "gray")

    def test_overdue_matches_candidates_and_overview_is_read_only(self) -> None:
        plan, phase = self._plan_with_phase()
        today = local_today()
        self.session.add(
            DailyTask(
                plan_id=plan.id,
                phase_id=phase.id,
                task_date=today - timedelta(days=2),
                week_label="W01",
                description="过期待补",
                status="pending",
            )
        )
        self.session.add(
            PlanAdjustment(
                user_id=self.user.id,
                plan_id=plan.id,
                status="pending",
                instruction="seed",
                basis_fingerprint="x" * 64,
                proposal={},
                diff={},
                validation={"ok": True},
                steps=[],
                decision_summary="",
                evidence_refs=[],
            )
        )
        self.session.commit()
        before = self.session.scalar(select(func.count()).select_from(PlanAdjustment)) or 0
        first = build_overview(self.session, self.user.id)
        second = build_overview(self.session, self.user.id)
        after = self.session.scalar(select(func.count()).select_from(PlanAdjustment)) or 0
        self.assertEqual(before, after)
        expected = len(remedy_service._candidates(self.session, plan, today))
        self.assertEqual(first["overdueCount"], expected)
        self.assertEqual(second["overdueCount"], expected)
        self.assertGreaterEqual(expected, 1)

    def test_today_tasks_exclude_carried_and_other_days(self) -> None:
        plan, phase = self._plan_with_phase()
        today = local_today()
        self.session.add_all(
            [
                DailyTask(
                    plan_id=plan.id,
                    phase_id=phase.id,
                    task_date=today,
                    week_label="W01",
                    description="今日完成",
                    status="done",
                ),
                DailyTask(
                    plan_id=plan.id,
                    phase_id=phase.id,
                    task_date=today,
                    week_label="W01",
                    description="今日待做",
                    status="pending",
                ),
                DailyTask(
                    plan_id=plan.id,
                    phase_id=phase.id,
                    task_date=today,
                    week_label="W01",
                    description="今日已顺延",
                    status="carried",
                ),
                DailyTask(
                    plan_id=plan.id,
                    phase_id=phase.id,
                    task_date=today - timedelta(days=1),
                    week_label="W01",
                    description="昨天",
                    status="done",
                ),
            ]
        )
        self.session.commit()
        overview = build_overview(self.session, self.user.id)
        self.assertEqual(overview["todayTasksTotal"], 2)
        self.assertEqual(overview["todayTasksDone"], 1)


if __name__ == "__main__":
    unittest.main()
