"""GET /api/journey：区间聚合、时区、权限、carried 口径。"""

from __future__ import annotations

import base64
import os
import unittest
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.entities import (
    CheckIn,
    DailyTask,
    MasteryEvidence,
    Phase,
    Plan,
    ReinforceTaskEvidence,
    User,
)
from app.services.session_service import session_store

TODAY = date(2026, 10, 19)


class JourneyRouteTests(unittest.TestCase):
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

        def override_get_db():
            session = cls.session_factory()
            try:
                yield session
            finally:
                session.close()

        app.dependency_overrides[get_db] = override_get_db

    @classmethod
    def tearDownClass(cls) -> None:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(cls.engine)
        cls.engine.dispose()
        session_store.clear()
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
        username = f"journey-{os.urandom(6).hex()}"
        self.client = TestClient(app)
        session_store.clear()
        registration = self.client.post(
            "/api/auth/register",
            json={"username": username, "password": "placeholder-password"},
        )
        self.assertEqual(registration.status_code, 201, registration.text)
        self.user = self.session.scalar(select(User).where(User.username == username))
        self.assertIsNotNone(self.user)
        login = self.client.post(
            "/api/auth/login",
            json={"username": username, "password": "placeholder-password"},
        )
        self.assertEqual(login.status_code, 200, login.text)

    def tearDown(self) -> None:
        self.client.close()
        self.session.close()
        session_store.clear()
        Base.metadata.drop_all(self.engine)

    def _plan(
        self,
        *,
        user: User | None = None,
        start: date = date(2026, 10, 13),
        goal: date = date(2026, 10, 25),
        name: str = "数据分析",
    ) -> tuple[Plan, Phase, Phase]:
        owner = user or self.user
        plan = Plan(
            user_id=owner.id,
            goal_name=name,
            start_date=start,
            goal_date=goal,
            current_level="入门",
            daily_minutes=60,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        first = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="阶段一",
            start_date=start,
            end_date=date(2026, 10, 16),
            is_current=False,
        )
        second = Phase(
            plan_id=plan.id,
            phase_index=2,
            name="阶段二",
            start_date=date(2026, 10, 17),
            end_date=goal,
            is_current=True,
        )
        self.session.add_all([first, second])
        self.session.commit()
        return plan, first, second

    def _task(
        self,
        plan: Plan,
        phase: Phase,
        day: date,
        status: str = "pending",
        *,
        carried_from: uuid.UUID | None = None,
    ) -> DailyTask:
        task = DailyTask(
            plan_id=plan.id,
            phase_id=phase.id,
            task_date=day,
            week_label="W42",
            description=f"{day.isoformat()} {status}",
            status=status,
            carried_from_id=carried_from,
        )
        self.session.add(task)
        self.session.commit()
        return task

    def _evidence(self, day: date, result: str, hour_utc: int = 4) -> None:
        # hour_utc=4 → 中国时区同一天中午。hour_utc=16 且 day 是「想测的 UTC 日」。
        self.session.add(
            MasteryEvidence(
                user_id=self.user.id,
                knowledge_point=None,
                evidence_type="quiz",
                result=result,
                created_at=datetime(
                    day.year, day.month, day.day, hour_utc, 0, tzinfo=timezone.utc
                ),
            )
        )
        self.session.commit()

    def _get(self, **params: str) -> dict:
        response = self.client.get("/api/journey", params={"today": TODAY.isoformat(), **params})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        return body

    def test_unauthenticated_returns_401(self) -> None:
        self.client.cookies.clear()
        response = self.client.get("/api/journey", params={"today": TODAY.isoformat()})
        self.assertEqual(response.status_code, 401)

    def test_no_plan_returns_empty_payload(self) -> None:
        body = self._get()
        self.assertIsNone(body["plan"])
        self.assertEqual(body["days"], [])
        self.assertEqual(body["summary"]["streakDays"], 0)
        self.assertEqual(body["today"], TODAY.isoformat())

    def test_invalid_date_is_validation_error(self) -> None:
        response = self.client.get("/api/journey", params={"today": "19-10-2026"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "VALIDATION")

    def test_range_over_400_days_is_rejected(self) -> None:
        self._plan(start=date(2025, 1, 1), goal=date(2027, 1, 1))
        response = self.client.get(
            "/api/journey",
            params={"today": TODAY.isoformat(), "from": "2025-01-01", "to": "2026-06-01"},
        )
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("400", response.json()["message"])

    def test_carried_stays_in_denominator_and_copy_is_tagged(self) -> None:
        plan, first, _second = self._plan()
        original = self._task(plan, first, date(2026, 10, 16), "carried")
        self._task(plan, first, date(2026, 10, 16), "done")
        # 顺延副本落在今天，属于今天的任务。
        self._task(plan, first, TODAY, "pending", carried_from=original.id)
        self._task(plan, first, TODAY, "done")

        body = self._get(**{"from": "2026-10-16", "to": TODAY.isoformat()})
        by_date = {row["date"]: row for row in body["days"]}
        missed = by_date["2026-10-16"]
        self.assertEqual(missed["total"], 2)
        self.assertEqual(missed["done"], 1)
        self.assertEqual(missed["carried"], 1)
        self.assertEqual(missed["stars"], 2)
        self.assertEqual(missed["rate"], 50)
        self.assertNotIn("carried", missed["tags"])
        self.assertEqual(missed["state"], "past")
        self.assertIn("boss", missed["tags"])

        today = by_date[TODAY.isoformat()]
        self.assertEqual(today["total"], 2)
        self.assertEqual(today["done"], 1)
        self.assertEqual(today["stars"], 2)
        self.assertEqual(today["state"], "today")
        self.assertIn("carried", today["tags"])

    def test_future_day_hides_stars_and_evidence_uses_china_day(self) -> None:
        plan, first, _second = self._plan()
        self._task(plan, first, date(2026, 10, 20), "pending")
        self._task(plan, first, date(2026, 10, 18), "done")
        # 2026-10-17 16:00 UTC = 2026-10-18 00:00 CST，应算到 18 日，不是 17 日。
        self._evidence(date(2026, 10, 17), "correct", hour_utc=16)
        self._evidence(date(2026, 10, 17), "wrong", hour_utc=16)

        body = self._get()
        by_date = {row["date"]: row for row in body["days"]}
        future = by_date["2026-10-20"]
        self.assertEqual(future["state"], "future")
        self.assertIsNone(future["stars"])
        self.assertIsNone(future["starColor"])
        self.assertEqual(future["total"], 1)

        eighteenth = by_date["2026-10-18"]
        self.assertEqual(eighteenth["answered"] if "answered" in eighteenth else eighteenth["accuracy"], 50)
        self.assertEqual(eighteenth["accuracy"], 50)
        self.assertEqual(eighteenth["starColor"], "cool")
        self.assertIsNone(by_date["2026-10-17"]["accuracy"])
        self.assertEqual(by_date["2026-10-17"]["state"], "empty")

    def test_other_users_plan_is_invisible(self) -> None:
        other_name = f"other-{os.urandom(4).hex()}"
        other_client = TestClient(app)
        created = other_client.post(
            "/api/auth/register",
            json={"username": other_name, "password": "placeholder-password"},
        )
        self.assertEqual(created.status_code, 201, created.text)
        other = self.session.scalar(select(User).where(User.username == other_name))
        plan, phase, _second = self._plan(user=other, name="别人的计划")
        self._task(plan, phase, TODAY, "done")

        body = self._get()
        self.assertIsNone(body["plan"])
        other_client.close()

    def test_summary_streak_week_stars_and_reinforce_tag(self) -> None:
        plan, first, second = self._plan()
        # 10-17、10-18 全清，今天 3/4。
        for day, done, total in (
            (date(2026, 10, 17), 2, 2),
            (date(2026, 10, 18), 2, 2),
            (TODAY, 3, 4),
        ):
            phase = first if day <= date(2026, 10, 16) else second
            for index in range(total):
                status = "done" if index < done else "pending"
                task = self._task(plan, phase, day, status)
                if day == TODAY and index == 0:
                    self.session.add(
                        ReinforceTaskEvidence(
                            task_id=task.id,
                            evidence_id=self._loose_evidence(),
                        )
                    )
                    self.session.commit()
        for offset in (0, 1, 2):
            self.session.add(
                CheckIn(
                    user_id=self.user.id,
                    check_date=TODAY - timedelta(days=offset),
                    duration_minutes=40,
                    difficulty=3,
                    energy=4,
                )
            )
        self.session.commit()

        body = self._get()
        summary = body["summary"]
        self.assertEqual(summary["streakDays"], 3)
        self.assertEqual(summary["bestStreak"], 3)
        self.assertEqual(summary["fullClearStreak"], 2)
        today = next(row for row in body["days"] if row["date"] == TODAY.isoformat())
        self.assertEqual(today["stars"], 3)
        self.assertIn("reinforce", today["tags"])
        self.assertGreaterEqual(summary["weekStars"], today["stars"])
        self.assertEqual(body["plan"]["goalName"], "数据分析")
        self.assertEqual(body["phases"][0]["index"], 1)
        self.assertEqual(body["phases"][1]["name"], "阶段二")

    def _loose_evidence(self) -> uuid.UUID:
        row = MasteryEvidence(
            user_id=self.user.id,
            evidence_type="quiz",
            result="wrong",
            created_at=datetime(2026, 10, 18, 4, 0, tzinfo=timezone.utc),
        )
        self.session.add(row)
        self.session.commit()
        return row.id


if __name__ == "__main__":
    unittest.main()
