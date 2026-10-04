"""Daily-task resource links: host whitelist, persistence, and API surface.

The product stance is "never invent an address" (``DEPLOY.md``), so the model may
name real platforms but only whitelisted hosts are persisted. These tests pin
both halves: the pure whitelist, and the write path that keeps a task alive while
dropping an untrustworthy link.
"""

import base64
import os
import unittest
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.entities import ApiConfig, DailyTask, Phase, Plan, User
from app.services import planner_service, resource_links, task_service
from app.services.planner_service import generate_plan, regenerate_plan
from app.services.session_service import session_store

BILIBILI = "https://www.bilibili.com"
FAKE_COURSE = "https://made-up-course.example.com/lesson/1"


def _today():
    return datetime.now(timezone.utc).date()


class ResourceLinkWhitelistTests(unittest.TestCase):
    def test_platform_hosts_and_subdomains_allowed(self) -> None:
        for url in (
            "https://bilibili.com",
            "https://www.bilibili.com",
            "https://www.icourse163.org/course/XIT-1002",
            "https://yz.chsi.com.cn",
            "https://www.tsinghua.edu.cn/yz/",
            "http://kaoyan.com",
        ):
            with self.subTest(url=url):
                self.assertEqual(resource_links.sanitize_resource_url(url), url)

    def test_untrusted_addresses_rejected(self) -> None:
        for value in (
            None,
            "",
            "   ",
            "bilibili.com",  # no scheme
            "ftp://bilibili.com",
            "javascript:alert(1)",
            "https://notbilibili.com",  # label boundary, not a substring
            "https://bilibili.com.evil.example",
            "https://evil.example/bilibili.com",
            "https://www.bilibili.com/a b",
            "https://" + "a" * 600 + ".com",
        ):
            with self.subTest(value=value):
                self.assertIsNone(resource_links.sanitize_resource_url(value))

    def test_suffix_rules_do_not_match_lookalike_hosts(self) -> None:
        self.assertFalse(resource_links.is_allowed_host("notedu.cn"))
        self.assertFalse(resource_links.is_allowed_host("edu.cn.evil.example"))
        self.assertTrue(resource_links.is_allowed_host("tsinghua.edu.cn"))
        self.assertTrue(resource_links.is_allowed_host("EDU.CN"))


class _DatabaseTestCase(unittest.IsolatedAsyncioTestCase):
    """Shared in-memory DB harness (mirrors the other service test modules)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls._environment = {
            name: os.environ.get(name)
            for name in ("DATABASE_URL", "DB_PASSWORD", "AES_KEY", "SESSION_TIMEOUT_MINUTES")
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
        self.user = User(username=f"res-{os.urandom(6).hex()}", password_hash="x" * 20)
        self.session.add(self.user)
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _add_verified_config(self) -> None:
        self.session.add(
            ApiConfig(
                user_id=self.user.id,
                api_key_cipher="cipher",
                model_type="gpt",
                base_url="https://example.com",
                is_verified=True,
            )
        )
        self.session.commit()


def _two_day_structure(*, with_links: bool) -> dict:
    """Two phases over the same two days, so ``_cover_phase_days`` adds nothing."""
    today = _today()
    first = today.isoformat()
    second = (today + timedelta(days=1)).isoformat()
    task_a = {
        "task_date": first,
        "week_label": "W01",
        "description": "数学：极限与连续",
    }
    task_b = {
        "task_date": second,
        "week_label": "W01",
        "description": "数学：导数定义",
    }
    if with_links:
        task_a["resource_url"] = BILIBILI
        task_b["resource_url"] = FAKE_COURSE
    return {
        "phases": [
            {
                "name": f"阶段 {index}",
                "start_date": first,
                "end_date": second,
                "daily_tasks": [dict(task_a), dict(task_b)],
            }
            for index in (1, 2)
        ]
    }


def _goal_payload() -> dict:
    return {
        "goalName": "考研数学",
        "goalDate": (_today() + timedelta(days=400)).isoformat(),
        "currentLevel": "零基础",
        "dailyMinutes": 120,
    }


class ResourceLinkPersistenceTests(_DatabaseTestCase):
    async def test_generate_keeps_allowed_link_and_drops_invented_one(self) -> None:
        self._add_verified_config()

        def generator(fields, used_docs, context_text, instruction):
            return _two_day_structure(with_links=True)

        await generate_plan(self.session, self.user.id, _goal_payload(), [], generator)

        tasks = list(self.session.scalars(select(DailyTask)))
        by_description = {task.description: task.resource_url for task in tasks}
        self.assertEqual(by_description["数学：极限与连续"], BILIBILI)
        # The untrustworthy host is dropped, the task itself survives.
        self.assertIsNone(by_description["数学：导数定义"])
        self.assertNotIn("made-up-course.example.com", str(list(by_description.values())))

    async def test_missing_resource_url_stays_none(self) -> None:
        self._add_verified_config()

        def generator(fields, used_docs, context_text, instruction):
            return _two_day_structure(with_links=False)

        await generate_plan(self.session, self.user.id, _goal_payload(), [], generator)

        tasks = list(self.session.scalars(select(DailyTask)))
        self.assertTrue(tasks)
        self.assertTrue(all(task.resource_url is None for task in tasks))

    async def test_regenerate_rebuilds_links_and_archives_them(self) -> None:
        self._add_verified_config()

        def with_link(fields, used_docs, context_text, instruction):
            return _two_day_structure(with_links=True)

        def without_link(fields, used_docs, context_text, instruction):
            return _two_day_structure(with_links=False)

        result = await generate_plan(
            self.session, self.user.id, _goal_payload(), [], with_link
        )
        await regenerate_plan(
            self.session,
            self.user.id,
            result.plan_id,
            "换一套不带链接的排法",
            None,
            [],
            without_link,
        )

        tasks = list(self.session.scalars(select(DailyTask)))
        self.assertTrue(all(task.resource_url is None for task in tasks))
        revisions = planner_service.list_plan_revisions(
            self.session, self.user.id, result.plan_id
        )
        self.assertEqual(len(revisions), 1)
        self.assertIn('"resourceUrl": "https://www.bilibili.com"', revisions[0].snapshot)

    async def test_carry_overdue_task_keeps_its_link(self) -> None:
        today = _today()
        plan = Plan(
            user_id=self.user.id,
            goal_name="考研数学",
            start_date=today - timedelta(days=10),
            goal_date=today + timedelta(days=100),
            current_level="零基础",
            daily_minutes=60,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        phase = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="阶段 1",
            start_date=today - timedelta(days=10),
            end_date=today,
            progress_percent=0,
            is_current=True,
            is_completed=False,
        )
        self.session.add(phase)
        self.session.flush()
        self.session.add(
            DailyTask(
                plan_id=plan.id,
                phase_id=phase.id,
                task_date=today - timedelta(days=3),
                week_label="W01",
                description="数学：极限",
                status="pending",
                resource_url=BILIBILI,
            )
        )
        self.session.commit()

        created = task_service.settle_overdue_tasks(self.session, self.user.id, today)

        self.assertEqual(len(created), 1)
        self.assertEqual(created[0].resource_url, BILIBILI)
        self.assertEqual(created[0].task_date, today)


class ResourceLinkRouteTests(_DatabaseTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()

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
        session_store.clear()
        super().tearDownClass()

    def setUp(self) -> None:
        super().setUp()
        session_store.clear()
        self.client = TestClient(app)
        username = f"res-route-{os.urandom(8).hex()}"
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
        session_store.clear()
        super().tearDown()

    def test_daily_tasks_response_exposes_resource_url(self) -> None:
        today = _today()
        plan = Plan(
            user_id=self.user.id,
            goal_name="考研数学",
            start_date=today,
            goal_date=today + timedelta(days=100),
            current_level="零基础",
            daily_minutes=60,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        phase = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="阶段 1",
            start_date=today,
            end_date=today,
            progress_percent=0,
            is_current=True,
            is_completed=False,
        )
        self.session.add(phase)
        self.session.flush()
        self.session.add(
            DailyTask(
                plan_id=plan.id,
                phase_id=phase.id,
                task_date=today,
                week_label="W01",
                description="数学：极限",
                status="pending",
                resource_url=BILIBILI,
            )
        )
        self.session.commit()

        response = self.client.get(f"/api/daily-tasks?date={today.isoformat()}")

        self.assertEqual(response.status_code, 200, response.text)
        tasks = response.json()["tasks"]
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["resourceUrl"], BILIBILI)
