"""Batch 23: route generation only writes course links the retriever ranked.

The model is offered a Top-K shortlist for the goal profile, and each task's
``resource_url`` must additionally be a hit of that task's own query. Membership
in ``courses.json`` alone is no longer enough.
"""

from __future__ import annotations

import base64
import json
import os
import unittest
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import httpx
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import ApiConfig, DailyTask, Phase, Plan, User
from app.routers.phases import phase_detail_route
from app.routers.study import _task_result
from app.services import direction_service, planner_service
from app.services.planner_service import confirm_draft_plan, generate_plan, regenerate_plan

DIRECTION = "scope-demo"
PY_URL = "https://www.icourse163.org/course/c-python"
EXCEL_URL = "https://www.icourse163.org/course/c-excel"
SQL_URL = "https://www.icourse163.org/course/c-sql"
EXTRA_URL = "https://www.icourse163.org/course/c-extra"
PY_CHAPTER_URL = "https://www.icourse163.org/course/c-python#chapter-1"
BILIBILI = "https://www.bilibili.com"

PY_TASK = "Python 变量与循环练习"
SQL_TASK = "SQL 联结与聚合子查询嵌套练习"


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _course(
    course_id: str,
    *,
    name: str,
    institution: str,
    skill: str,
    chapter: str,
    sections: list[str],
) -> dict:
    return {
        "course_id": course_id,
        "name": name,
        "institution": institution,
        "provider": "平台",
        "url": f"https://www.icourse163.org/course/{course_id}",
        "url_verified": True,
        "skills": [skill],
        "collected_at": "2026-10-21",
        "chapters": [{"index": 1, "title": chapter, "sections": sections}],
    }


def scope_courses() -> dict:
    return {
        "directions": [
            {
                "id": DIRECTION,
                "name": "检索范围演示",
                "description": "",
                "skills": ["Python", "Excel", "SQL", "Tableau"],
                "courses": [
                    _course(
                        "c-python",
                        name="Python 脚本入门",
                        institution="机构甲",
                        skill="Python",
                        chapter="第1章 Python 基础",
                        sections=["变量与循环", "函数定义"],
                    ),
                    _course(
                        "c-excel",
                        name="Excel 透视表实战",
                        institution="机构乙",
                        skill="Excel",
                        chapter="第1章 Excel 表格",
                        sections=["函数与透视", "图表美化"],
                    ),
                    _course(
                        "c-sql",
                        name="SQL 查询精讲",
                        institution="机构丙",
                        skill="SQL",
                        chapter="第1章 SQL 查询",
                        sections=["联结与聚合", "子查询嵌套"],
                    ),
                    _course(
                        "c-extra",
                        name="Tableau 仪表盘",
                        institution="机构丁",
                        skill="Tableau",
                        chapter="第1章 Tableau",
                        sections=["仪表盘发布"],
                    ),
                ],
            }
        ]
    }


def goal(**overrides) -> dict:
    payload = {
        "goalName": "Python 与 Excel 办公自动化",
        "goalDate": (_today() + timedelta(days=400)).isoformat(),
        "currentLevel": "零基础",
        "dailyMinutes": 60,
        "completionCriterion": "能写脚本并做出透视表",
        "directionId": DIRECTION,
    }
    payload.update(overrides)
    return payload


def task_top_k(description: str, fields: dict) -> list[str]:
    """Independent re-run of the task query against the same fixture."""
    query = "\n".join(
        [
            description,
            str(fields["goalName"]),
            str(fields["currentLevel"]),
            str(fields["completionCriterion"]),
        ]
    )
    return [
        item["courseId"]
        for item in direction_service.rank_courses(
            DIRECTION, query, courses_data=scope_courses()
        )
    ]


def offered_course_ids(fields: dict) -> list[str]:
    return [
        item["courseId"]
        for item in planner_service._target_course_candidates(fields)
    ]


def structure(tasks: list[dict]) -> dict:
    today = _today()
    first = today.isoformat()
    second = (today + timedelta(days=1)).isoformat()
    while len(tasks) < 2:
        tasks.append(
            {
                "task_date": second if len(tasks) else first,
                "week_label": "W01",
                "description": f"占位任务 {len(tasks) + 1}",
            }
        )
    return {
        "phases": [
            {
                "name": "阶段 1",
                "start_date": first,
                "end_date": second,
                "daily_tasks": [dict(tasks[0]), dict(tasks[1])],
            },
            {
                "name": "阶段 2",
                "start_date": first,
                "end_date": second,
                "daily_tasks": [
                    {"task_date": first, "week_label": "W01", "description": "阶段2复习"},
                    {"task_date": second, "week_label": "W01", "description": "阶段2练习"},
                ],
            },
        ]
    }


def single_task(description: str, resource_url: str | None = None) -> dict:
    item = {
        "task_date": _today().isoformat(),
        "week_label": "W01",
        "description": description,
    }
    if resource_url is not None:
        item["resource_url"] = resource_url
    return item


class _DatabaseCase(unittest.IsolatedAsyncioTestCase):
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
        self.user = User(username=f"dir-{os.urandom(6).hex()}", password_hash="x" * 20)
        self.session.add(self.user)
        self.session.flush()
        self.session.add(
            ApiConfig(
                user_id=self.user.id,
                api_key_cipher="cipher",
                model_type="gpt",
                base_url="https://example.com/v1/chat/completions",
                is_verified=True,
            )
        )
        self.session.commit()
        self.courses_patch = patch(
            "app.services.direction_service.load_courses", return_value=scope_courses()
        )
        self.courses_patch.start()

    def tearDown(self) -> None:
        self.courses_patch.stop()
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _tasks(self) -> dict[str, str | None]:
        return {
            task.description: task.resource_url
            for task in self.session.scalars(select(DailyTask))
        }

    def _assert_links_follow_task_top_k(self, fields: dict) -> None:
        """Every written URL belongs to its own task's Top-K ∩ offered set."""
        offered = set(offered_course_ids(fields))
        by_url = {
            item["url"]: item["courseId"]
            for item in planner_service._target_course_candidates(fields)
        }
        self.assertTrue(offered)
        for description, url in self._tasks().items():
            if url is None:
                continue
            self.assertIn(url, by_url, f"{description} 的链接不在本次候选里")
            self.assertIn(
                by_url[url],
                task_top_k(description, fields),
                f"{description} 的链接不在该任务 Top-K 里",
            )


class GenerateScopeTests(_DatabaseCase):
    async def test_offered_candidate_outside_task_top_k_is_dropped(self) -> None:
        fields = goal()
        self.assertIn("c-python", offered_course_ids(fields))
        self.assertNotIn("c-python", task_top_k(SQL_TASK, fields))

        def generator(fields_, used_docs, context_text, instruction):
            return structure([single_task(SQL_TASK, PY_URL)])

        await generate_plan(self.session, self.user.id, fields, [], generator)
        self.assertIsNone(self._tasks()[SQL_TASK])

    async def test_task_top_k_course_outside_offered_set_is_dropped(self) -> None:
        fields = goal()
        self.assertIn("c-sql", task_top_k(SQL_TASK, fields))
        self.assertNotIn("c-sql", offered_course_ids(fields))

        def generator(fields_, used_docs, context_text, instruction):
            return structure([single_task(SQL_TASK, SQL_URL)])

        await generate_plan(self.session, self.user.id, fields, [], generator)
        self.assertIsNone(self._tasks()[SQL_TASK])

    async def test_catalogue_course_never_ranked_is_dropped(self) -> None:
        fields = goal()

        def generator(fields_, used_docs, context_text, instruction):
            return structure([single_task("Tableau 仪表盘发布练习", EXTRA_URL)])

        await generate_plan(self.session, self.user.id, fields, [], generator)
        self.assertIsNone(self._tasks()["Tableau 仪表盘发布练习"])

    async def test_matching_task_link_survives_and_every_link_is_in_top_k(self) -> None:
        fields = goal()

        def generator(fields_, used_docs, context_text, instruction):
            return structure(
                [
                    single_task(PY_TASK, PY_URL),
                    single_task("Excel 函数与透视练习", EXCEL_URL),
                ]
            )

        await generate_plan(self.session, self.user.id, fields, [], generator)
        tasks = self._tasks()
        self.assertEqual(tasks[PY_TASK], PY_URL)
        self.assertEqual(tasks["Excel 函数与透视练习"], EXCEL_URL)
        self._assert_links_follow_task_top_k(fields)

    async def test_matched_chapter_url_is_the_top_k_link(self) -> None:
        courses = scope_courses()
        courses["directions"][0]["courses"][0]["chapters"][0][
            "url"
        ] = PY_CHAPTER_URL
        fields = goal()

        def generator(fields_, used_docs, context_text, instruction):
            return structure(
                [
                    single_task(PY_TASK, PY_CHAPTER_URL),
                    single_task("Python 函数定义练习", PY_URL),
                ]
            )

        with patch("app.services.direction_service.load_courses", return_value=courses):
            offered = planner_service._target_course_candidates(fields)
            self.assertIn(PY_CHAPTER_URL, [item["url"] for item in offered])
            await generate_plan(self.session, self.user.id, fields, [], generator)
            self.assertIn(
                PY_CHAPTER_URL,
                [
                    item["url"]
                    for item in direction_service.rank_courses(
                        DIRECTION,
                        planner_service._task_query(PY_TASK, fields),
                    )
                ],
            )
        self.assertEqual(self._tasks()[PY_TASK], PY_CHAPTER_URL)
        self.assertIsNone(self._tasks()["Python 函数定义练习"])

    async def test_task_api_exposes_matched_titles_and_empty_when_unmatched(self) -> None:
        fields = goal()

        def generator(fields_, used_docs, context_text, instruction):
            return structure([single_task(PY_TASK, PY_URL)])

        await generate_plan(self.session, self.user.id, fields, [], generator)
        matched = self.session.scalar(
            select(DailyTask).where(DailyTask.description == PY_TASK)
        )
        self.assertIsNotNone(matched)
        self.assertEqual(matched.chapter_title, "第1章 Python 基础")
        self.assertEqual(matched.section_title, "变量与循环")
        self.assertEqual(_task_result(matched)["sectionTitle"], "变量与循环")

        response = phase_detail_route(str(matched.phase_id), self.user, self.session)
        phase_tasks = json.loads(response.body)["tasks"]
        by_description = {item["description"]: item for item in phase_tasks}
        self.assertEqual(by_description[PY_TASK]["chapterTitle"], "第1章 Python 基础")
        self.assertEqual(by_description[PY_TASK]["sectionTitle"], "变量与循环")
        self.assertIsNone(by_description["占位任务 2"]["chapterTitle"])
        self.assertIsNone(by_description["占位任务 2"]["sectionTitle"])

    async def test_rank_returning_empty_offers_nothing_and_writes_no_url(self) -> None:
        fields = goal()

        def generator(fields_, used_docs, context_text, instruction):
            return structure([single_task(PY_TASK, PY_URL)])

        with patch("app.services.retrieval.rank", return_value=[]):
            self.assertEqual(planner_service._target_course_candidates(fields), [])
            scope = planner_service._course_url_scope(fields, [])
            self.assertIsNotNone(scope)
            self.assertEqual(scope("任意任务描述"), {})
            result = await generate_plan(self.session, self.user.id, fields, [], generator)

        self.assertEqual(result.phases, 2)
        tasks = self._tasks()
        self.assertIn(PY_TASK, tasks)
        self.assertTrue(all(url is None for url in tasks.values()))
        self.assertTrue(
            all(
                task.chapter_title is None and task.section_title is None
                for task in self.session.scalars(select(DailyTask))
            )
        )

    async def test_model_message_lists_only_ranked_candidates(self) -> None:
        """With ranking empty the catalog message must vanish, not fall back."""
        captured: dict = {}
        real_client = httpx.AsyncClient

        def handler(request: httpx.Request) -> httpx.Response:
            captured["payload"] = json.loads(request.content.decode("utf-8"))
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {"message": {"content": json.dumps(structure([]), ensure_ascii=False)}}
                    ]
                },
            )

        def factory(*args, **kwargs):
            kwargs = dict(kwargs)
            kwargs["transport"] = httpx.MockTransport(handler)
            return real_client(*args, **kwargs)

        with patch("app.services.retrieval.rank", return_value=[]), patch(
            "app.services.planner_service.httpx.AsyncClient", side_effect=factory
        ), patch(
            "app.services.planner_service.resolve_credential",
            return_value=type(
                "C",
                (),
                {
                    "model_type": "gpt",
                    "base_url": "https://example.com/v1/chat/completions",
                    "api_key": "sk-test",
                },
            )(),
        ), patch(
            "app.services.planner_service.build_outbound_headers",
            return_value={"Authorization": "Bearer sk-test"},
        ):
            await generate_plan(self.session, self.user.id, goal(), [], None)

        messages = captured["payload"]["messages"]
        self.assertEqual(len(messages), 2)
        for message in messages[1:]:
            self.assertNotIn("平台课程库候选", message["content"])
            for url in (PY_URL, EXCEL_URL, SQL_URL, EXTRA_URL):
                self.assertNotIn(url, message["content"])

    async def test_no_direction_keeps_sanitize_only_behaviour(self) -> None:
        fields = goal(directionId=None)
        self.assertEqual(planner_service._target_course_candidates(fields), [])
        self.assertIsNone(planner_service._course_url_scope(fields, []))

        def generator(fields_, used_docs, context_text, instruction):
            return structure(
                [
                    single_task(PY_TASK, BILIBILI),
                    single_task("自造链接任务", "https://made-up.example/course"),
                ]
            )

        await generate_plan(self.session, self.user.id, fields, [], generator)
        tasks = self._tasks()
        self.assertEqual(tasks[PY_TASK], BILIBILI)
        self.assertIsNone(tasks["自造链接任务"])
        plan = self.session.scalar(select(Plan))
        self.assertIsNone(plan.direction_id)


class DirectionPersistenceTests(_DatabaseCase):
    async def test_first_generate_stores_direction_id(self) -> None:
        def generator(fields_, used_docs, context_text, instruction):
            return structure([single_task(PY_TASK, PY_URL)])

        await generate_plan(self.session, self.user.id, goal(), [], generator)
        plan = self.session.scalar(select(Plan))
        self.assertEqual(plan.direction_id, DIRECTION)

    async def test_confirm_preview_stores_direction_and_constrains_urls(self) -> None:
        fields = goal()
        preview = structure([single_task(SQL_TASK, SQL_URL)])
        result = confirm_draft_plan(self.session, self.user.id, fields, preview, [])

        plan = self.session.scalar(select(Plan).where(Plan.id == result.plan_id))
        self.assertEqual(plan.direction_id, DIRECTION)
        self.assertIsNone(self._tasks()[SQL_TASK])

    async def test_regenerate_keeps_direction_and_its_url_gate(self) -> None:
        def first(fields_, used_docs, context_text, instruction):
            return structure([single_task(PY_TASK, PY_URL)])

        created = await generate_plan(self.session, self.user.id, goal(), [], first)

        def second(fields_, used_docs, context_text, instruction):
            self.assertEqual(fields_["directionId"], DIRECTION)
            return structure([single_task(SQL_TASK, PY_URL)])

        await regenerate_plan(
            self.session, self.user.id, created.plan_id, "换成 SQL 那一节", None, [], second
        )
        plan = self.session.scalar(select(Plan).where(Plan.id == created.plan_id))
        self.assertEqual(plan.direction_id, DIRECTION)
        self.assertIsNone(self._tasks()[SQL_TASK])

    async def test_regenerate_applies_explicit_direction_override(self) -> None:
        def generator(fields_, used_docs, context_text, instruction):
            return structure([single_task(PY_TASK, PY_URL)])

        created = await generate_plan(
            self.session, self.user.id, goal(directionId=None), [], generator
        )
        await regenerate_plan(
            self.session,
            self.user.id,
            created.plan_id,
            "按检索范围演示方向重排",
            {"directionId": DIRECTION},
            [],
            generator,
        )
        plan = self.session.scalar(select(Plan).where(Plan.id == created.plan_id))
        self.assertEqual(plan.direction_id, DIRECTION)

    async def test_historical_plan_without_direction_stays_direction_less(self) -> None:
        today = _today()
        plan = Plan(
            user_id=self.user.id,
            goal_name="Python 与 Excel 办公自动化",
            start_date=today,
            goal_date=today + timedelta(days=200),
            current_level="零基础",
            daily_minutes=60,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        self.session.add(
            Phase(
                plan_id=plan.id,
                phase_index=1,
                name="阶段 1",
                start_date=today,
                end_date=today,
                is_current=True,
            )
        )
        self.session.commit()
        self.assertIsNone(plan.direction_id)

        def generator(fields_, used_docs, context_text, instruction):
            self.assertNotIn("directionId", fields_)
            return structure([single_task(PY_TASK, BILIBILI)])

        await regenerate_plan(
            self.session, self.user.id, plan.id, "换成 bilibili", None, [], generator
        )
        self.assertIsNone(self.session.scalar(select(Plan)).direction_id)
        self.assertEqual(self._tasks()[PY_TASK], BILIBILI)


if __name__ == "__main__":
    unittest.main()
