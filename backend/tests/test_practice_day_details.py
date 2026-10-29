"""Day details use Beijing boundaries and never expose another user's evidence."""
import unittest
from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.entities import MasteryEvidence, Phase, Plan, User
from app.routers.dependencies import get_current_user


class PracticeDayTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.session = Session(self.engine, expire_on_commit=False)
        self.user = User(username="calendar-owner", password_hash="x" * 20)
        self.other = User(username="calendar-other", password_hash="x" * 20)
        self.session.add_all([self.user, self.other])
        self.session.commit()
        self.overrides = app.dependency_overrides.copy()
        app.dependency_overrides[get_current_user] = lambda: self.user
        app.dependency_overrides[get_db] = lambda: self.session
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.overrides)
        self.session.close()
        self.engine.dispose()

    def add(self, stamp, result="correct", user=None, phase=None):
        row = MasteryEvidence(user_id=(user or self.user).id, knowledge_point=phase.id if phase else None, result=result, evidence_type="quiz", created_at=datetime.fromisoformat(stamp).astimezone(timezone.utc), grade_reason="真实判分理由", error_tag="概念")
        self.session.add(row)
        return row

    def phase(self, user):
        day = date(2026, 10, 29)
        plan = Plan(user_id=user.id, goal_name="test", start_date=day, goal_date=day + timedelta(days=10), current_level="beginner", daily_minutes=30, total_phases=2)
        self.session.add(plan)
        self.session.flush()
        phase = Phase(plan_id=plan.id, phase_index=1, name="私有阶段" if user == self.other else "自己的阶段", start_date=day, end_date=day + timedelta(days=5))
        self.session.add(phase)
        self.session.flush()
        return phase

    def test_beijing_day_bounds_and_real_distribution(self):
        self.add("2026-10-28T15:59:59+00:00", "wrong")
        self.add("2026-10-28T16:00:00+00:00", "correct")
        self.add("2026-10-29T00:00:00+00:00", "partial")
        self.add("2026-10-29T15:59:59+00:00", "wrong")
        self.add("2026-10-29T16:00:00+00:00", "correct")
        self.add("2026-10-29T00:00:00+00:00", "correct", self.other)
        self.session.commit()
        response = self.client.get("/api/statistics/practice-days/2026-10-29")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["answered"], 3)
        self.assertEqual(data["distribution"], {"correct": 1, "partial": 1, "wrong": 1})
        self.assertEqual(data["score"], 50)
        self.assertEqual(data["timezone"], "Asia/Shanghai")
        self.assertEqual(len(data["evidence"]), 3)
        self.assertFalse(data["truncated"])

    def test_phase_names_are_owned_and_unknown_links_stay_unknown(self):
        owned = self.phase(self.user)
        foreign = self.phase(self.other)
        self.add("2026-10-29T00:00:00Z", phase=owned)
        self.add("2026-10-29T01:00:00Z", phase=foreign)
        self.add("2026-10-29T02:00:00Z", user=self.other, phase=foreign)
        self.session.commit()
        data = self.client.get("/api/statistics/practice-days/2026-10-29").json()
        self.assertEqual(data["answered"], 2)
        self.assertEqual({item["phaseName"] for item in data["evidence"]}, {"自己的阶段", None})
        self.assertTrue(all(item["gradeReason"] == "真实判分理由" for item in data["evidence"]))

    def test_empty_is_unknown_but_recorded_wrong_is_zero(self):
        empty = self.client.get("/api/statistics/practice-days/2026-10-29").json()
        self.assertEqual(empty["answered"], 0)
        self.assertIsNone(empty["score"])
        self.assertEqual(empty["evidence"], [])
        self.add("2026-10-29T00:00:00Z", "wrong")
        self.session.commit()
        self.assertEqual(self.client.get("/api/statistics/practice-days/2026-10-29").json()["score"], 0)

    def test_capped_details_keep_full_aggregate(self):
        for _ in range(101):
            self.add("2026-10-29T00:00:00Z", "partial")
        self.session.commit()
        data = self.client.get("/api/statistics/practice-days/2026-10-29").json()
        self.assertEqual(data["total"], 101)
        self.assertEqual(data["distribution"]["partial"], 101)
        self.assertEqual(data["score"], 50)
        self.assertEqual(len(data["evidence"]), 100)
        self.assertTrue(data["truncated"])

    def test_invalid_dates_fail_instead_of_showing_empty_data(self):
        for day in ["2026-02-30", "20261029", "2026-13-01", "0001-01-01"]:
            with self.subTest(day=day):
                self.assertEqual(self.client.get(f"/api/statistics/practice-days/{day}").status_code, 422)
        self.assertEqual(self.client.get("/api/statistics/practice-days/9999-12-31").status_code, 200)

    def test_authentication_is_required(self):
        app.dependency_overrides.pop(get_current_user)
        self.assertEqual(self.client.get("/api/statistics/practice-days/2026-10-29").status_code, 401)
