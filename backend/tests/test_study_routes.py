import base64
import os
import unittest
import uuid
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
from app.models.entities import CheckIn, DailyTask, Phase, Plan, User
from app.services.session_service import session_store


class StudyRouteTests(unittest.TestCase):
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
        username = f"study-route-{os.urandom(8).hex()}"
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

    def _seed_plan_with_task(
        self, task_date: date, status: str = "pending"
    ) -> tuple[Plan, Phase, DailyTask]:
        plan = Plan(
            user_id=self.user.id,
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
            end_date=date(2025, 2, 1),
        )
        self.session.add(phase)
        self.session.flush()
        task = DailyTask(
            plan_id=plan.id,
            phase_id=phase.id,
            task_date=task_date,
            week_label="W01",
            description="今日任务",
            status=status,
        )
        self.session.add(task)
        self.session.commit()
        return plan, phase, task

    # --- POST /api/check-ins -----------------------------------------------

    def test_create_check_in_returns_201_and_persists(self) -> None:
        response = self.client.post(
            "/api/check-ins",
            json={
                "checkDate": "2025-02-10",
                "durationMinutes": 90,
                "difficulty": 3,
                "energy": 4,
                "note": "专注",
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertIn("checkInId", body)

        self.session.expire_all()
        rows = list(
            self.session.scalars(
                select(CheckIn).where(CheckIn.user_id == self.user.id)
            )
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].duration_minutes, 90)

    def test_create_check_in_invalid_duration_returns_400(self) -> None:
        response = self.client.post(
            "/api/check-ins",
            json={
                "checkDate": "2025-02-10",
                "durationMinutes": 0,
                "difficulty": 3,
                "energy": 4,
            },
        )
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["code"], "VALIDATION")

    def test_create_check_in_invalid_date_returns_400(self) -> None:
        response = self.client.post(
            "/api/check-ins",
            json={
                "checkDate": "not-a-date",
                "durationMinutes": 60,
                "difficulty": 3,
                "energy": 4,
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "VALIDATION")

    def test_create_check_in_unauthenticated_returns_401(self) -> None:
        self.client.cookies.clear()
        response = self.client.post(
            "/api/check-ins",
            json={
                "checkDate": "2025-02-10",
                "durationMinutes": 60,
                "difficulty": 3,
                "energy": 4,
            },
        )
        self.assertEqual(response.status_code, 401)

    def test_add_today_task_creates_once_on_current_phase(self) -> None:
        _, phase, existing = self._seed_plan_with_task(date(2025, 2, 10), status="done")
        created = self.client.post(
            "/api/daily-tasks", json={"taskDate": "2025-02-11"}
        )
        self.assertEqual(created.status_code, 201, created.text)
        body = created.json()["task"]
        self.assertEqual(body["taskDate"], "2025-02-11")
        self.assertEqual(body["phaseId"], str(phase.id))
        self.assertEqual(body["status"], "pending")
        self.assertIn("阶段 1", body["description"])

        again = self.client.post(
            "/api/daily-tasks", json={"taskDate": "2025-02-11"}
        )
        self.assertEqual(again.status_code, 200, again.text)
        self.assertEqual(again.json()["task"]["id"], body["id"])

        self.session.expire_all()
        phase_row = self.session.get(Phase, phase.id)
        self.assertEqual(phase_row.progress_percent, 50)
        self.assertNotEqual(body["id"], str(existing.id))

    def test_add_today_task_without_plan_is_404(self) -> None:
        response = self.client.post(
            "/api/daily-tasks", json={"taskDate": "2025-02-11"}
        )
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(response.json()["code"], "NO_PLAN")

    # --- GET /api/daily-tasks ----------------------------------------------

    def test_daily_tasks_returns_own_tasks(self) -> None:
        _, _, task = self._seed_plan_with_task(date(2025, 2, 10))
        response = self.client.get("/api/daily-tasks?date=2025-02-10")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(len(body["tasks"]), 1)
        self.assertEqual(body["tasks"][0]["id"], str(task.id))
        # 查询日早于今天时，读取前会把仍 pending 的任务标成 carried。
        expected = "carried" if date(2025, 2, 10) < date.today() else "pending"
        self.assertEqual(body["tasks"][0]["status"], expected)
        self.assertEqual(body["tasks"][0]["weekLabel"], "W01")

    def test_daily_tasks_missing_date_returns_400(self) -> None:
        response = self.client.get("/api/daily-tasks")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "VALIDATION")

    def test_daily_tasks_invalid_date_returns_400(self) -> None:
        response = self.client.get("/api/daily-tasks?date=13-13-13")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "VALIDATION")

    def test_daily_tasks_unauthenticated_returns_401(self) -> None:
        self.client.cookies.clear()
        response = self.client.get("/api/daily-tasks?date=2025-02-10")
        self.assertEqual(response.status_code, 401)

    # --- PATCH /api/daily-tasks/{id}/status --------------------------------

    def test_patch_task_status_updates_phase_progress(self) -> None:
        _, phase, task = self._seed_plan_with_task(date(2025, 2, 10))
        # Add a second task in the same phase so done = 1/2 = 50%.
        second = DailyTask(
            plan_id=task.plan_id,
            phase_id=phase.id,
            task_date=date(2025, 2, 11),
            week_label="W01",
            description="任务2",
            status="pending",
        )
        self.session.add(second)
        self.session.commit()

        response = self.client.patch(
            f"/api/daily-tasks/{task.id}/status", json={"status": "done"}
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["task"]["status"], "done")
        self.assertEqual(body["phase"]["progressPercent"], 50)

    def test_patch_task_invalid_status_returns_400(self) -> None:
        _, _, task = self._seed_plan_with_task(date(2025, 2, 10))
        response = self.client.patch(
            f"/api/daily-tasks/{task.id}/status", json={"status": "archived"}
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "VALIDATION")

    def test_patch_unknown_task_returns_404(self) -> None:
        response = self.client.patch(
            f"/api/daily-tasks/{uuid.uuid4()}/status", json={"status": "done"}
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "NOT_FOUND")

    def test_patch_malformed_task_id_returns_404(self) -> None:
        response = self.client.patch(
            "/api/daily-tasks/not-a-uuid/status", json={"status": "done"}
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "NOT_FOUND")

    def test_patch_task_unauthenticated_returns_401(self) -> None:
        _, _, task = self._seed_plan_with_task(date(2025, 2, 10))
        self.client.cookies.clear()
        response = self.client.patch(
            f"/api/daily-tasks/{task.id}/status", json={"status": "done"}
        )
        self.assertEqual(response.status_code, 401)

    # --- GET /api/metrics/overview -----------------------------------------

    def test_metrics_overview_returns_structure(self) -> None:
        self._seed_plan_with_task(date(2025, 2, 10))
        self.client.post(
            "/api/check-ins",
            json={
                "checkDate": "2025-02-10",
                "durationMinutes": 90,
                "difficulty": 3,
                "energy": 4,
            },
        )
        response = self.client.get("/api/metrics/overview?today=2025-02-10")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["totalMinutes"], 90)
        self.assertEqual(body["streakDays"], 1)
        self.assertIn("remainingDays", body)
        self.assertEqual(set(body["phaseProgress"].keys()), {"completed", "total"})
        self.assertEqual(body["todayStatus"], "已完成")

    def test_metrics_overview_missing_today_returns_400(self) -> None:
        response = self.client.get("/api/metrics/overview")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "VALIDATION")

    def test_metrics_overview_invalid_today_returns_400(self) -> None:
        response = self.client.get("/api/metrics/overview?today=nope")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "VALIDATION")

    def test_metrics_overview_unauthenticated_returns_401(self) -> None:
        self.client.cookies.clear()
        response = self.client.get("/api/metrics/overview?today=2025-02-10")
        self.assertEqual(response.status_code, 401)

    def test_phase_tasks_returns_the_phase_and_404_for_unknown(self) -> None:
        _, phase, task = self._seed_plan_with_task(date(2025, 2, 10))
        response = self.client.get(f"/api/phases/{phase.id}/tasks")
        self.assertEqual(response.status_code, 200, response.text)
        ids = [item["id"] for item in response.json()["tasks"]]
        self.assertIn(str(task.id), ids)
        missing = self.client.get(f"/api/phases/{uuid.uuid4()}/tasks")
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json()["code"], "NOT_FOUND")

    def test_practice_upload_wrong_answer_joins_mistake_book(self) -> None:
        created = self.client.post(
            "/api/practice", json={"question": "1+1 等于几", "answer": "2", "subject": "数学"}
        )
        self.assertEqual(created.status_code, 201, created.text)
        question_id = created.json()["question"]["id"]
        marked = self.client.patch(
            f"/api/practice/{question_id}/status",
            json={"status": "wrong", "myAnswer": "3"},
        )
        self.assertEqual(marked.status_code, 200, marked.text)
        self.assertIsNotNone(marked.json()["question"]["sourceMistakeId"])
        listed = self.client.get("/api/mistakes")
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertIn("1+1 等于几", listed.text)

    def test_practice_generate_without_config_returns_no_api_key(self) -> None:
        response = self.client.post("/api/practice/generate", json={"date": "2026-10-04"})
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["code"], "NO_API_KEY")


if __name__ == "__main__":
    unittest.main()
