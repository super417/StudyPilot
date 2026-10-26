"""The resume must never promote task completion into verified mastery."""

import unittest
from datetime import date, datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.entities import DailyTask, MasteryEvidence, Phase, Plan, User
from app.services.resume_service import build_resume


class ResumeServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        self.user = User(username="learner", password_hash="secret")
        self.other = User(username="other", password_hash="other-secret")
        self.session.add_all([self.user, self.other])
        self.session.flush()
        self.plan = Plan(
            user_id=self.user.id,
            goal_name="学习目标",
            start_date=date(2025, 1, 1),
            goal_date=date(2025, 12, 31),
            current_level="初学者",
            daily_minutes=60,
            total_phases=2,
        )
        self.session.add(self.plan)
        self.session.flush()

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def phase(self, name: str, index: int, *, completed: bool = True) -> Phase:
        phase = Phase(
            plan_id=self.plan.id,
            phase_index=index,
            name=name,
            start_date=date(2025, 1, 1),
            end_date=date(2025, 3, 1),
        )
        self.session.add(phase)
        self.session.flush()
        self.session.add(
            DailyTask(
                plan_id=self.plan.id,
                phase_id=phase.id,
                task_date=date(2025, 2, 1),
                week_label="W05",
                description="练习",
                status="done" if completed else "pending",
            )
        )
        self.session.flush()
        return phase

    def evidence(self, phase: Phase, result: str, *, user: User | None = None) -> None:
        self.session.add(
            MasteryEvidence(
                user_id=(user or self.user).id,
                knowledge_point=phase.id,
                evidence_type="quiz",
                result=result,
                created_at=datetime(2025, 2, 1, tzinfo=timezone.utc),
            )
        )
        self.session.flush()

    def test_no_evidence_cannot_be_verified(self) -> None:
        self.phase("数据处理", 1)
        result = build_resume(self.session, self.user.id)
        self.assertEqual(result["verified"], [])
        self.assertEqual(result["learned"][0]["evidenceCount"], 0)
        self.assertIsNone(result["learned"][0]["masteryPercent"])

    def test_59_below_threshold_and_60_at_threshold(self) -> None:
        low = self.phase("低于门槛", 1)
        edge = self.phase("恰好达线", 2)
        # 59% = 29 correct + 1 partial + 20 wrong, over 50 answers.
        for result, count in (("correct", 29), ("partial", 1), ("wrong", 20)):
            for _ in range(count):
                self.evidence(low, result)
        # 60% = 3 correct + 2 wrong, over 5 answers.
        for result in ("correct", "correct", "correct", "wrong", "wrong"):
            self.evidence(edge, result)
        result = build_resume(self.session, self.user.id)
        self.assertEqual(result["learned"][0]["masteryPercent"], 59)
        self.assertEqual(result["verified"][0]["masteryPercent"], 60)

    def test_other_users_evidence_and_secrets_are_excluded(self) -> None:
        phase = self.phase("阶段", 1)
        self.evidence(phase, "correct", user=self.other)
        result = build_resume(self.session, self.user.id)
        self.assertEqual(result["verified"], [])
        self.assertNotIn("secret", str(result))
        self.assertNotIn("username", str(result))

    def test_date_window_filters_evidence(self) -> None:
        phase = self.phase("阶段", 1)
        self.evidence(phase, "correct")
        result = build_resume(
            self.session, self.user.id, date(2025, 3, 1), date(2025, 3, 31)
        )
        self.assertEqual(result["verified"], [])
        self.assertIsNone(result["learned"][0]["masteryPercent"])


if __name__ == "__main__":
    unittest.main()
