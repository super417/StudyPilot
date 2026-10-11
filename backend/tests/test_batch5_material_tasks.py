"""第五批第 3 子批第 1 步：资料任务预览门控。不确认、不落库。"""

import asyncio
import base64
import json
import os
import unittest
import uuid
from datetime import date, timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, update
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.clock import local_today
from app.core.config import get_settings
from app.core.crypto import encrypt, get_cipher
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.entities import ApiConfig, DailyTask, Phase, Plan, PlanAdjustment, User, UserDocument
from app.routers.materials import get_link_reader, get_material_advisor, get_material_task_model
from app.routers.plans import get_plan_generator
from app.services.material_comparison_store import material_comparison_store
from app.services.material_task_preview_store import material_task_preview_store
from app.services import material_comparison_service, material_task_service
from app.services.material_task_service import preview_material_tasks
from app.services.plan_draft_store import plan_draft_store
from app.services.session_service import session_store


GOAL = {
    "goalName": "线性代数入门",
    "goalDate": "2027-06-30",
    "currentLevel": "学过矩阵",
    "dailyMinutes": 45,
    "completionCriterion": "能独立证明秩不等式",
}


def _structure(minutes: int | None = 25, task_date: str | None = None, gap: bool = True) -> dict:
    today = local_today()
    first = task_date or today.isoformat()
    second = (today + timedelta(days=2)).isoformat()
    phase_end = (today + timedelta(days=1)).isoformat() if gap else first
    task: dict = {
        "task_date": first,
        "description": "线性代数：矩阵秩，做例题 1-3，写出秩的结论",
    }
    if minutes is not None:
        task["estimated_minutes"] = minutes
    return {
        "phases": [
            {
                "name": "秩",
                "start_date": first,
                "end_date": phase_end,
                "daily_tasks": [task],
            },
            {
                "name": "练习",
                "start_date": second,
                "end_date": second,
                "daily_tasks": [
                    {
                        "task_date": second,
                        "description": "线性代数：用选定摘录做两道题，交出错题",
                        "estimated_minutes": 10,
                    }
                ],
            },
        ]
    }


def _link_material(url: str) -> dict:
    return {
        "url": url,
        "title": "线性代数课",
        "source": "example.com",
        "summary": "讲秩",
        "body": "",
        "sections": [{"label": "第1节", "url": url, "duration": 180}],
        "has_outline": True,
    }


class MaterialTaskPreviewTests(unittest.TestCase):
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
        cls.session_factory = sessionmaker(bind=cls.engine, class_=Session, expire_on_commit=False)

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
        session_store.clear()
        material_comparison_store.clear()
        material_task_preview_store.clear()
        plan_draft_store.clear()
        self.client = TestClient(app)
        username = f"b5t-{os.urandom(4).hex()}"
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
        self.model_calls = 0

        async def reader(url: str):
            if url.endswith("/title"):
                return {
                    "url": url,
                    "title": "只有标题",
                    "summary": "",
                    "body": "",
                    "sections": [],
                    "has_outline": False,
                }
            return _link_material(url)

        async def advisor(_facts: str, _goal: dict) -> str:
            raise RuntimeError("比较建议不应被任务预览调用")

        async def model(system: str, user: str) -> str:
            self.model_calls += 1
            self.last_prompt = (system, user)
            return json.dumps(_structure(), ensure_ascii=False)

        app.dependency_overrides[get_link_reader] = lambda: reader
        app.dependency_overrides[get_material_advisor] = lambda: advisor
        app.dependency_overrides[get_material_task_model] = lambda: model

    def tearDown(self) -> None:
        app.dependency_overrides.pop(get_link_reader, None)
        app.dependency_overrides.pop(get_material_advisor, None)
        app.dependency_overrides.pop(get_material_task_model, None)
        app.dependency_overrides.pop(get_plan_generator, None)
        self.client.close()
        self.session.close()
        session_store.clear()
        material_comparison_store.clear()
        material_task_preview_store.clear()
        plan_draft_store.clear()
        Base.metadata.drop_all(self.engine)

    def _counts(self) -> dict[str, int]:
        self.session.expire_all()
        return {
            name: int(self.session.scalar(select(func.count()).select_from(model)) or 0)
            for name, model in (
                ("plans", Plan),
                ("phases", Phase),
                ("tasks", DailyTask),
                ("adjustments", PlanAdjustment),
            )
        }

    def _doc(self, doc_id: str, content: str, extra: str | None = None) -> None:
        rows = [
            UserDocument(
                user_id=self.user.id,
                doc_id=doc_id,
                filename=f"{doc_id}.txt",
                file_type="txt",
                chunk_index=0,
                content=content,
            )
        ]
        if extra is not None:
            rows.append(
                UserDocument(
                    user_id=self.user.id,
                    doc_id=doc_id,
                    filename=f"{doc_id}.txt",
                    file_type="txt",
                    chunk_index=1,
                    content=extra,
                )
            )
        self.session.add_all(rows)
        self.session.commit()

    def _compare(self, **extra: object):
        payload = {**GOAL, "documentIds": ["doc-la"], "links": []}
        payload.update(extra)
        return self.client.post("/api/materials/compare", json=payload)

    def _select(self, comparison_id: str, candidate_id: str, **extra: object):
        payload = {"candidateId": candidate_id, **GOAL}
        payload.update(extra)
        return self.client.post(f"/api/materials/comparisons/{comparison_id}/select", json=payload)

    def _preview(self, comparison_id: str, **extra: object):
        payload = {**GOAL, "planId": None}
        payload.update(extra)
        return self.client.post(
            f"/api/materials/comparisons/{comparison_id}/task-preview",
            json=payload,
        )

    def test_selected_document_preview_stays_closed_and_unpersisted(self) -> None:
        self._doc("doc-la", "矩" * 1000, "未纳入的行列式")
        self._doc("doc-other", "未选中的概率论正文")
        before = self._counts()
        opened = self._compare(documentIds=["doc-la", "doc-other"])
        self.assertEqual(opened.status_code, 200, opened.text)
        comparison_id = opened.json()["comparisonId"]
        chosen = self._select(comparison_id, "doc:doc-la")
        self.assertEqual(chosen.status_code, 200, chosen.text)
        preview = self._preview(
            comparison_id,
            excerpts="浏览器伪造正文",
            contentHash="浏览器伪造哈希",
            documentIds=["doc-other"],
        )
        self.assertEqual(preview.status_code, 200, preview.text)
        body = preview.json()
        self.assertFalse(body["confirmOpen"])
        self.assertTrue(body["validation"]["ok"])
        self.assertEqual(body["basis"]["docId"], "doc-la")
        self.assertEqual([item["chunkIndex"] for item in body["basis"]["chunks"]], [0])
        self.assertNotIn("浏览器伪造", json.dumps(body, ensure_ascii=False))
        self.assertNotIn("未选中的概率论正文", json.dumps(body, ensure_ascii=False))
        self.assertNotIn("未纳入的行列式", json.dumps(body, ensure_ascii=False))
        descriptions = [
            task["description"]
            for phase in body["phases"]
            for task in phase["tasks"]
        ]
        self.assertIn("写出秩的结论", descriptions[0])
        self.assertIn("交出错题", descriptions[1])
        self.assertEqual(descriptions[0].count("精读与例题"), 0)
        self.assertTrue(body["emptyDates"])
        self.assertIn("矩" * 20, self.last_prompt[1])
        self.assertNotIn("未选中的概率论正文", self.last_prompt[1])
        self.assertNotIn("未纳入的行列式", self.last_prompt[1])
        self.assertNotIn("每天覆盖", self.last_prompt[0] + self.last_prompt[1])
        self.assertNotIn("常见目录", self.last_prompt[0] + self.last_prompt[1])
        self.assertNotIn("没有上传资料", self.last_prompt[0] + self.last_prompt[1])
        confirmed = self.client.post(f"/api/materials/task-previews/{body['previewId']}/confirm", json={})
        self.assertEqual(confirmed.status_code, 409, confirmed.text)
        self.assertEqual(confirmed.json()["code"], "CONFIRM_NOT_OPEN")
        self.assertEqual(self._counts(), before)
        self.assertEqual(plan_draft_store._drafts, {})

    def test_blocks_and_rule_failures_do_not_write(self) -> None:
        self._doc("doc-la", "矩阵与秩")
        opened = self._compare()
        comparison_id = opened.json()["comparisonId"]
        before = self._counts()
        missing = self._preview(comparison_id)
        self.assertEqual(missing.status_code, 409, missing.text)
        self.assertEqual(missing.json()["code"], "NO_SELECTION")
        self.assertEqual(self.model_calls, 0)

        titled = self._compare(documentIds=[], links=["https://example.com/title"])
        titled_id = titled.json()["comparisonId"]
        selected = self._select(titled_id, "link:0")
        self.assertEqual(selected.status_code, 200, selected.text)
        rejected = self._preview(titled_id)
        self.assertEqual(rejected.status_code, 409, rejected.text)
        self.assertEqual(rejected.json()["code"], "SOURCE_UNAVAILABLE")
        self.assertEqual(self.model_calls, 0)

        reopened = self._compare()
        comparison_id = reopened.json()["comparisonId"]
        self._select(comparison_id, "doc:doc-la")
        changed = self._preview(comparison_id, goalName="概率论入门")
        self.assertEqual(changed.status_code, 409, changed.text)
        self.assertEqual(changed.json()["code"], "GOAL_CHANGED")

        async def overload(_system: str, _user: str) -> str:
            return json.dumps(_structure(minutes=50), ensure_ascii=False)

        async def unknown(_system: str, _user: str) -> str:
            return json.dumps(_structure(minutes=None), ensure_ascii=False)

        async def illegal(_system: str, _user: str) -> str:
            raw = _structure()
            raw["phases"][0]["daily_tasks"][0]["task_date"] = "2026-13-40"
            return json.dumps(raw, ensure_ascii=False)

        app.dependency_overrides[get_material_task_model] = lambda: overload
        heavy = self._preview(comparison_id)
        self.assertEqual(heavy.status_code, 200, heavy.text)
        self.assertFalse(heavy.json()["confirmOpen"])
        self.assertEqual(heavy.json()["validation"]["checks"]["duration"], "fail")
        self.assertNotIn("精读与例题", json.dumps(heavy.json(), ensure_ascii=False))

        app.dependency_overrides[get_material_task_model] = lambda: unknown
        blank = self._preview(comparison_id)
        self.assertEqual(blank.status_code, 200, blank.text)
        self.assertFalse(blank.json()["confirmOpen"])
        self.assertEqual(blank.json()["validation"]["checks"]["duration"], "unknown")

        app.dependency_overrides[get_material_task_model] = lambda: illegal
        dated = self._preview(comparison_id)
        self.assertEqual(dated.status_code, 200, dated.text)
        self.assertFalse(dated.json()["confirmOpen"])
        self.assertEqual(dated.json()["validation"]["checks"]["schedule"], "fail")
        self.assertIn("写出秩的结论", json.dumps(dated.json(), ensure_ascii=False))
        self.assertEqual(self._counts(), before)

    def test_production_transport_sees_only_the_selected_link(self) -> None:
        self._doc("doc-la", "矩阵与秩的正文")
        self.session.add(
            ApiConfig(
                user_id=self.user.id,
                api_key_cipher=encrypt("temporary-test-key"),
                model_type="gpt",
                base_url="https://example.invalid/v1",
                is_verified=True,
            )
        )
        self.session.commit()
        app.dependency_overrides.pop(get_material_task_model, None)
        opened = self._compare(documentIds=["doc-la"], links=["https://example.com/course"])
        comparison_id = opened.json()["comparisonId"]
        self._select(comparison_id, "link:0")
        captured: list[dict] = []

        class _Lines:
            status_code = 200

            async def aiter_lines(self):
                payload = {"choices": [{"delta": {"content": json.dumps(_structure(), ensure_ascii=False)}}]}
                yield "data: " + json.dumps(payload, ensure_ascii=False)
                yield "data: [DONE]"

            async def aread(self):
                return b""

        class _Stream:
            async def __aenter__(self):
                return _Lines()

            async def __aexit__(self, *_args):
                return False

        class _Client:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            def stream(self, method, url, headers=None, json=None):
                captured.append(json or {})
                return _Stream()

        with patch("httpx.AsyncClient", _Client):
            preview = self._preview(comparison_id)
        self.assertEqual(preview.status_code, 200, preview.text)
        self.assertFalse(preview.json()["confirmOpen"])
        sent = json.dumps(captured, ensure_ascii=False)
        self.assertIn("https://example.com/course", sent)
        self.assertIn("讲秩", sent)
        self.assertNotIn("矩阵与秩的正文", sent)
        self.assertNotIn("没有上传资料", sent)
        self.assertNotIn("常见目录", sent)
        self.assertNotIn("每天覆盖", sent)
        self.assertNotIn("排满", sent)
        self.assertNotIn("temporary-test-key", sent)

        from sqlalchemy import delete

        self.session.execute(delete(ApiConfig))
        self.session.commit()
        captured.clear()
        with patch("httpx.AsyncClient", _Client):
            blocked = self._preview(comparison_id)
        self.assertNotEqual(blocked.status_code, 200, blocked.text)
        self.assertEqual(blocked.json()["code"], "NO_API_KEY")
        self.assertEqual(captured, [])
        self.assertIsNone(material_task_preview_store.current(self.user.id))

    def test_stale_or_failed_generation_does_not_restore_an_older_preview(self) -> None:
        self._doc("doc-la", "矩阵与秩")
        self._doc("doc-other", "另一份正文")
        opened = self._compare(documentIds=["doc-la", "doc-other"])
        comparison_id = opened.json()["comparisonId"]
        self._select(comparison_id, "doc:doc-la")

        async def interleave() -> None:
            entered = asyncio.Event()
            release = asyncio.Event()

            async def hanging(_system: str, _user: str) -> str:
                entered.set()
                await release.wait()
                return json.dumps(_structure(), ensure_ascii=False)

            async def failing(_system: str, _user: str) -> str:
                raise RuntimeError("传输失败")

            older = asyncio.create_task(
                preview_material_tasks(
                    self.session,
                    self.user.id,
                    comparison_id,
                    dict(GOAL),
                    None,
                    hanging,
                )
            )
            await entered.wait()
            from app.services.material_comparison_service import select_material

            select_material(
                self.session, self.user.id, comparison_id, "doc:doc-other", dict(GOAL)
            )
            release.set()
            with self.assertRaises(Exception) as caught:
                await older
            self.assertEqual(getattr(caught.exception, "code", ""), "GENERATION_STALE")
            self.assertIsNone(material_task_preview_store.current(self.user.id))
            with self.assertRaises(Exception):
                await preview_material_tasks(
                    self.session,
                    self.user.id,
                    comparison_id,
                    dict(GOAL),
                    None,
                    failing,
                )
            self.assertIsNone(material_task_preview_store.current(self.user.id))

        asyncio.run(interleave())
        confirmed = self.client.post("/api/materials/task-previews/missing/confirm", json={})
        self.assertEqual(confirmed.status_code, 409, confirmed.text)
        self.assertEqual(self._counts(), {"plans": 0, "phases": 0, "tasks": 0, "adjustments": 0})

    def test_existing_plan_counts_protected_minutes_without_writing(self) -> None:
        today = local_today()
        plan = Plan(
            user_id=self.user.id,
            goal_name=GOAL["goalName"],
            start_date=today,
            goal_date=date(2027, 6, 30),
            current_level=GOAL["currentLevel"],
            daily_minutes=45,
            completion_criterion=GOAL["completionCriterion"],
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        phase = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="已有阶段",
            start_date=today,
            end_date=plan.goal_date,
        )
        self.session.add(phase)
        self.session.flush()
        self.session.add(
            DailyTask(
                plan_id=plan.id,
                phase_id=phase.id,
                task_date=today,
                week_label="W41",
                description="已完成的原任务",
                status="done",
                estimated_minutes=30,
            )
        )
        self.session.commit()
        self._doc("doc-la", "矩阵与秩")
        before = self._counts()
        opened = self._compare(planId=str(plan.id))
        self.assertEqual(opened.status_code, 200, opened.text)
        comparison_id = opened.json()["comparisonId"]
        self._select(comparison_id, "doc:doc-la")

        async def same_day(_system: str, _user: str) -> str:
            raw = _structure(minutes=20, gap=False)
            return json.dumps(raw, ensure_ascii=False)

        app.dependency_overrides[get_material_task_model] = lambda: same_day
        preview = self._preview(comparison_id, planId=str(plan.id))
        self.assertEqual(preview.status_code, 200, preview.text)
        body = preview.json()
        self.assertFalse(body["confirmOpen"])
        self.assertEqual(body["validation"]["checks"]["duration"], "fail")
        self.assertEqual(self._counts(), before)

    def _draft_id_from(self, response) -> str:
        frames = [
            json.loads(line.removeprefix("data:").strip())
            for line in response.text.splitlines()
            if line.startswith("data:")
        ]
        previews = [frame for frame in frames if frame.get("draftId") and frame.get("summary")]
        self.assertTrue(previews, response.text)
        return previews[0]["draftId"]

    def _arm_old_generator(self) -> None:
        self.session.add(
            ApiConfig(
                user_id=self.user.id,
                api_key_cipher=encrypt("temporary-test-key"),
                model_type="gpt",
                base_url="https://example.invalid/v1",
                is_verified=True,
            )
        )
        self.session.commit()

        async def old_generator(*_args):
            return _structure()

        app.dependency_overrides[get_plan_generator] = lambda: old_generator

    def test_comparison_blocks_leftover_draft_but_old_path_still_confirms(self) -> None:
        self._arm_old_generator()
        self._doc("doc-la", "矩阵与秩")
        opened = self.client.post("/api/plans/generate", json={**GOAL, "documentIds": []})
        self.assertEqual(opened.status_code, 200, opened.text)
        draft_id = self._draft_id_from(opened)
        before = self._counts()
        confirmed = self.client.post(f"/api/plans/{draft_id}/clarify", json={"message": "确定"})
        self.assertIn("event: done", confirmed.text)
        self.assertGreater(self._counts()["plans"], before["plans"])

        opened_again = self.client.post("/api/plans/generate", json={**GOAL, "documentIds": []})
        leftover = self._draft_id_from(opened_again)
        before_compare = self._counts()
        compared = self._compare()
        self.assertEqual(compared.status_code, 200, compared.text)
        blocked = self.client.post(f"/api/plans/{leftover}/clarify", json={"message": "确定"})
        self.assertNotIn("event: done", blocked.text)
        self.assertEqual(self._counts(), before_compare)

        resumed = self.client.post("/api/plans/generate", json={**GOAL, "documentIds": []})
        fresh = self._draft_id_from(resumed)
        self.assertNotEqual(fresh, leftover)
        written = self.client.post(f"/api/plans/{fresh}/clarify", json={"message": "确定"})
        self.assertIn("event: done", written.text)
        self.assertGreater(self._counts()["plans"], before_compare["plans"])
        still_blocked = self.client.post(f"/api/plans/{leftover}/clarify", json={"message": "确定"})
        self.assertNotIn("event: done", still_blocked.text)

    def test_blocked_draft_rejects_document_parameter(self) -> None:
        self._arm_old_generator()
        self._doc("doc-la", "矩阵与秩")
        opened = self.client.post("/api/plans/generate", json={**GOAL, "documentIds": []})
        self.assertEqual(opened.status_code, 200, opened.text)
        leftover = self._draft_id_from(opened)
        compared = self._compare()
        self.assertEqual(compared.status_code, 200, compared.text)
        self.assertTrue(plan_draft_store.get(leftover, self.user.id).confirm_blocked)
        before = self._counts()
        blocked = self.client.post(
            f"/api/plans/{leftover}/clarify",
            json={"message": "确定", "documentIds": ["doc-la"]},
        )
        self.assertNotIn("event: done", blocked.text)
        self.assertEqual(self._counts(), before)

        resumed = self.client.post("/api/plans/generate", json={**GOAL, "documentIds": []})
        fresh = self._draft_id_from(resumed)
        written = self.client.post(f"/api/plans/{fresh}/clarify", json={"message": "确定"})
        self.assertIn("event: done", written.text)
        after_fresh = self._counts()
        self.assertGreater(after_fresh["plans"], before["plans"])
        again = self.client.post(
            f"/api/plans/{leftover}/clarify",
            json={"message": "确定", "documentIds": ["doc-la"]},
        )
        self.assertNotIn("event: done", again.text)
        self.assertEqual(self._counts(), after_fresh)

    def test_unbound_comparison_rejects_nonnull_plan_before_model(self) -> None:
        self._doc("doc-la", "矩阵与秩")
        opened = self._compare()
        self.assertEqual(opened.status_code, 200, opened.text)
        comparison_id = opened.json()["comparisonId"]
        self._select(comparison_id, "doc:doc-la")
        response = self._preview(comparison_id, planId=str(uuid.uuid4()))
        self.assertNotEqual(response.status_code, 200, response.text)
        self.assertEqual(self.model_calls, 0)
        self.assertIsNone(material_task_preview_store.current(self.user.id))

    def test_live_plan_and_expiry_block_publish(self) -> None:
        today = material_task_service.local_today()
        plan = Plan(
            user_id=self.user.id,
            goal_name=GOAL["goalName"],
            start_date=today,
            goal_date=date.fromisoformat(GOAL["goalDate"]),
            current_level=GOAL["currentLevel"],
            daily_minutes=GOAL["dailyMinutes"],
            completion_criterion=GOAL["completionCriterion"],
            total_phases=2,
        )
        self.session.add(plan)
        self.session.commit()
        self._doc("doc-la", "矩阵与秩")
        opened = self._compare(planId=str(plan.id))
        self.assertEqual(opened.status_code, 200, opened.text)
        comparison_id = opened.json()["comparisonId"]
        self._select(comparison_id, "doc:doc-la")

        async def change_cap(_system: str, _user: str) -> str:
            self.session.execute(update(Plan).where(Plan.id == plan.id).values(daily_minutes=10))
            self.session.commit()
            return json.dumps(_structure(minutes=25), ensure_ascii=False)

        app.dependency_overrides[get_material_task_model] = lambda: change_cap
        changed = self._preview(comparison_id, planId=str(plan.id))
        self.assertNotEqual(changed.status_code, 200, changed.text)
        self.assertIsNone(material_task_preview_store.current(self.user.id))
        self.assertEqual(self.session.get(Plan, plan.id).daily_minutes, 10)

        opened_again = self._compare()
        self.assertEqual(opened_again.status_code, 200, opened_again.text)
        second = opened_again.json()["comparisonId"]
        self._select(second, "doc:doc-la")
        clock = [material_comparison_service._now()]

        async def expire(_system: str, _user: str) -> str:
            clock[0] += material_comparison_service.COMPARISON_TTL + timedelta(seconds=1)
            return json.dumps(_structure(), ensure_ascii=False)

        app.dependency_overrides[get_material_task_model] = lambda: expire
        with patch.object(material_task_service, "_now", side_effect=lambda: clock[0]):
            expired = self._preview(second)
        self.assertNotEqual(expired.status_code, 200, expired.text)
        self.assertIsNone(material_task_preview_store.current(self.user.id))

    def test_extreme_dates_fail_inside_a_bounded_window(self) -> None:
        self._doc("doc-la", "矩阵与秩")
        opened = self._compare()
        comparison_id = opened.json()["comparisonId"]
        self._select(comparison_id, "doc:doc-la")

        async def extreme(_system: str, _user: str) -> str:
            structure = _structure()
            structure["phases"][1]["start_date"] = "9999-12-31"
            structure["phases"][1]["end_date"] = "9999-12-31"
            structure["phases"][1]["daily_tasks"][0]["task_date"] = "9999-12-31"
            return json.dumps(structure)

        app.dependency_overrides[get_material_task_model] = lambda: extreme
        cookies = dict(self.client.cookies)
        self.client.close()
        self.client = TestClient(app, raise_server_exceptions=False, cookies=cookies)
        before = self._counts()
        response = self._preview(comparison_id)
        self.assertNotEqual(response.status_code, 500, response.text)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertFalse(body["confirmOpen"])
        self.assertFalse(body["validation"]["ok"])
        self.assertIn("9999-12-31", response.text)
        self.assertEqual(self._counts(), before)
        self.assertLess(len(body["emptyDates"]), 4000)

        async def wide(_system: str, _user: str) -> str:
            structure = _structure()
            structure["phases"][1]["start_date"] = "1000-01-01"
            structure["phases"][1]["end_date"] = "9999-12-31"
            structure["phases"][1]["daily_tasks"][0]["task_date"] = "1000-01-01"
            return json.dumps(structure)

        app.dependency_overrides[get_material_task_model] = lambda: wide
        started = __import__("time").perf_counter()
        wide_response = self._preview(comparison_id)
        elapsed = __import__("time").perf_counter() - started
        self.assertNotEqual(wide_response.status_code, 500, wide_response.text)
        self.assertLess(elapsed, 2)
        self.assertEqual(self._counts(), before)
        self.assertIn("9999-12-31", wide_response.text)
        self.assertFalse(wide_response.json()["validation"]["ok"])
