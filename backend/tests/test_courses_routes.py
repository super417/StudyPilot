import base64
import os
import unittest
from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.entities import Course, DailyTask, Phase, Plan, User
from app.services.session_service import session_store


class CourseRouteTests(unittest.TestCase):
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
        username = f"course-{os.urandom(8).hex()}"
        self.client = TestClient(app)
        session_store.clear()
        registration = self.client.post(
            "/api/auth/register",
            json={"username": username, "password": "placeholder-password"},
        )
        self.assertEqual(registration.status_code, 201, registration.text)
        self.user = self.session.scalar(select(User).where(User.username == username))
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

    def test_overview_counts_active_and_matches_next_task(self) -> None:
        plan = Plan(
            user_id=self.user.id,
            goal_name="考研",
            start_date=date(2026, 1, 1),
            goal_date=date(2026, 12, 1),
            current_level="基础",
            daily_minutes=120,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        phase = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="高等数学强化",
            start_date=date(2026, 1, 1),
            end_date=date(2026, 3, 1),
            is_current=True,
        )
        later = Phase(
            plan_id=plan.id,
            phase_index=2,
            name="英语",
            start_date=date(2026, 3, 2),
            end_date=date(2026, 6, 1),
        )
        self.session.add_all([phase, later])
        self.session.flush()
        self.session.flush()
        self.session.add(
            DailyTask(
                plan_id=plan.id,
                phase_id=phase.id,
                task_date=date(2026, 1, 2),
                week_label="W01",
                description="完成极限习题",
                status="pending",
            )
        )
        self.session.commit()

        created = self.client.post("/api/courses", json={"name": "高等数学"})
        self.assertEqual(created.status_code, 201, created.text)
        body = created.json()
        self.assertEqual(body["activeCount"], 1)
        self.assertEqual(body["recentCourse"], "高等数学")
        self.assertEqual(body["nextTask"], "完成极限习题")

        course_id = body["courses"][0]["id"]
        paused = self.client.put(
            f"/api/courses/{course_id}",
            json={"name": "高等数学", "status": "paused"},
        )
        self.assertEqual(paused.status_code, 200, paused.text)
        self.assertEqual(paused.json()["activeCount"], 0)
        self.assertEqual(paused.json()["recentCourse"], "高等数学")

    def test_duplicate_name_rejected(self) -> None:
        first = self.client.post("/api/courses", json={"name": "英语"})
        self.assertEqual(first.status_code, 201, first.text)
        second = self.client.post("/api/courses", json={"name": "英语"})
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.json()["code"], "VALIDATION")

    def test_foreign_course_is_not_found(self) -> None:
        other = User(username=f"other-{os.urandom(4).hex()}", password_hash="x")
        self.session.add(other)
        self.session.commit()
        course = Course(user_id=other.id, name="政治", status="active")
        self.session.add(course)
        self.session.commit()
        response = self.client.delete(f"/api/courses/{course.id}")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "NOT_FOUND")


if __name__ == "__main__":
    unittest.main()
