"""Batch 15a: direction list / jobs / skill-gap (read-only)."""

from __future__ import annotations

import base64
import copy
import os
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.services import direction_service
from app.services.direction_service import DirectionNotFoundError
from app.services.session_service import session_store


def _fixture() -> tuple[dict, dict]:
    jobs = {
        "directions": [
            {
                "id": "demo-dir",
                "name": "演示方向",
                "jobs": [
                    {
                        "job_id": "j1",
                        "title": "岗A",
                        "company_type": "企业",
                        "city": "北京",
                        "seniority": "初级",
                        "education": "本科",
                        "major_pref": [],
                        "skills_required": ["技能甲", "技能乙"],
                        "skills_preferred": ["技能丙"],
                        "source_platform": "平台",
                        "source_url": "https://example.com/j1",
                        "collected_at": "2026-10-13",
                        "verification": "collected",
                    },
                    {
                        "job_id": "j2",
                        "title": "岗B",
                        "company_type": "企业",
                        "city": "上海",
                        "seniority": "初级",
                        "education": "本科",
                        "major_pref": [],
                        "skills_required": ["技能甲"],
                        "skills_preferred": ["技能丁"],
                        "source_platform": "平台",
                        "source_url": "https://example.com/j2",
                        "collected_at": "2026-10-13",
                        "verification": "collected",
                    },
                    {
                        "job_id": "j3",
                        "title": "岗C",
                        "company_type": "企业",
                        "city": "深圳",
                        "seniority": "中级",
                        "education": "本科",
                        "major_pref": [],
                        "skills_required": ["技能甲", "技能戊"],
                        "skills_preferred": [],
                        "source_platform": "平台",
                        "source_url": "https://example.com/j3",
                        "collected_at": "2026-10-13",
                        "verification": "collected",
                    },
                ],
            }
        ]
    }
    courses = {
        "directions": [
            {
                "id": "demo-dir",
                "name": "演示方向",
                "description": "用于验收",
                "skills": ["技能甲", "技能乙", "技能丙", "技能丁"],
                "courses": [
                    {
                        "course_id": "c-verified",
                        "name": "已验证课",
                        "institution": "机构A",
                        "provider": "平台A",
                        "url": "https://www.icourse163.org/course/c-verified",
                        "url_verified": True,
                        "skills": ["技能甲", "技能乙"],
                        "collected_at": "2026-10-13",
                        "chapters": [],
                    },
                    {
                        "course_id": "c-unverified",
                        "name": "未验证课",
                        "institution": "机构B",
                        "provider": "平台B",
                        "url": "https://www.icourse163.org/course/c-unverified",
                        "url_verified": False,
                        "skills": ["技能甲", "技能乙", "技能丙"],
                        "collected_at": "2026-10-13",
                        "chapters": [],
                    },
                ],
            }
        ]
    }
    return jobs, courses


class SkillGapUnitTests(unittest.TestCase):
    def test_unverified_courses_never_appear(self) -> None:
        jobs, courses = _fixture()
        payload = direction_service.compute_skill_gap(
            "demo-dir", [], jobs_data=jobs, courses_data=courses
        )
        course_ids = {
            course["courseId"]
            for gap in payload["gaps"]
            for course in gap["courses"]
        }
        self.assertIn("c-verified", course_ids)
        self.assertNotIn("c-unverified", course_ids)

    def test_sorts_by_required_count_first(self) -> None:
        jobs, courses = _fixture()
        payload = direction_service.compute_skill_gap(
            "demo-dir", [], jobs_data=jobs, courses_data=courses
        )
        skills = [gap["skill"] for gap in payload["gaps"]]
        # 技能甲 required=3, 技能乙 required=1, 技能戊 required=1,
        # 技能丙 preferred=1, 技能丁 preferred=1
        self.assertEqual(skills[0], "技能甲")
        self.assertEqual(payload["gaps"][0]["requiredBy"], 3)
        eth_index = skills.index("技能乙")
        bing_index = skills.index("技能丙")
        self.assertLess(eth_index, bing_index)

    def test_known_filters_gaps_and_updates_coverage(self) -> None:
        jobs, courses = _fixture()
        empty = direction_service.compute_skill_gap(
            "demo-dir", [], jobs_data=jobs, courses_data=courses
        )
        filtered = direction_service.compute_skill_gap(
            "demo-dir",
            ["技能甲", "外星技能"],
            jobs_data=jobs,
            courses_data=courses,
        )
        self.assertNotIn("技能甲", [gap["skill"] for gap in filtered["gaps"]])
        self.assertIn("技能甲", [gap["skill"] for gap in empty["gaps"]])
        self.assertEqual(filtered["coverage"]["total"], 4)
        self.assertEqual(filtered["coverage"]["covered"], 1)
        self.assertEqual(filtered["coverage"]["percent"], 25)
        self.assertEqual(empty["coverage"]["covered"], 0)
        self.assertEqual(empty["coverage"]["percent"], 0)

    def test_gap_without_verified_course_keeps_empty_courses(self) -> None:
        jobs, courses = _fixture()
        payload = direction_service.compute_skill_gap(
            "demo-dir", [], jobs_data=jobs, courses_data=courses
        )
        by_skill = {gap["skill"]: gap for gap in payload["gaps"]}
        # 技能戊 only appears in jobs; no course covers it
        self.assertIn("技能戊", by_skill)
        self.assertEqual(by_skill["技能戊"]["courses"], [])
        # 技能丙 only covered by unverified course → empty after filter
        self.assertEqual(by_skill["技能丙"]["courses"], [])


class DirectionRouteTests(unittest.TestCase):
    """Route smoke tests. Auth is stubbed — env bcrypt/passlib is unrelated to 15a."""

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
        from types import SimpleNamespace
        import uuid as uuid_mod

        from app.routers.dependencies import get_current_user

        Base.metadata.create_all(self.engine)
        self.client = TestClient(app)
        session_store.clear()
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
            id=uuid_mod.uuid4()
        )

    def tearDown(self) -> None:
        from app.routers.dependencies import get_current_user

        self.client.close()
        app.dependency_overrides.pop(get_current_user, None)
        session_store.clear()
        Base.metadata.drop_all(self.engine)

    def test_unknown_direction_returns_404(self) -> None:
        response = self.client.get("/api/directions/does-not-exist/skill-gap")
        self.assertEqual(response.status_code, 404)
        body = response.json()
        self.assertEqual(body["status"], "error")
        self.assertEqual(body["code"], "NOT_FOUND")

    def test_list_directions_ok(self) -> None:
        response = self.client.get("/api/directions")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        ids = {item["id"] for item in body["directions"]}
        self.assertIn("ai-finance", ids)
        self.assertIn("ai-education", ids)


class DirectionNotFoundUnitTests(unittest.TestCase):
    def test_compute_unknown_raises(self) -> None:
        jobs, courses = _fixture()
        with self.assertRaises(DirectionNotFoundError):
            direction_service.compute_skill_gap(
                "missing", [], jobs_data=jobs, courses_data=copy.deepcopy(courses)
            )


if __name__ == "__main__":
    unittest.main()
