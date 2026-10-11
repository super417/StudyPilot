"""第五批第 2 子批：资料比较与临时选择。注入读取和模型，不写任务。"""

import asyncio
import base64
import json
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
import unittest

from app.core.config import get_settings
from app.core.crypto import encrypt, get_cipher
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.entities import (
    ApiConfig,
    DailyTask,
    Phase,
    Plan,
    PlanAdjustment,
    User,
    UserDocument,
)
from app.routers.materials import get_link_reader, get_material_advisor
from app.services.material_comparison_service import MaterialComparisonError, compare_materials, select_material
from app.services.material_comparison_store import material_comparison_store
from app.services.session_service import session_store
from app.services.video_draft_store import VideoDraft, video_draft_store
from app.services.video_link import suggest_start


GOAL = {
    "goalName": "线性代数入门",
    "goalDate": "2027-06-30",
    "currentLevel": "学过矩阵",
    "dailyMinutes": 45,
    "completionCriterion": "能独立证明秩不等式",
}


def _link_material(url: str, *, title: str, outline: bool, summary: str, durations: list[int]) -> dict:
    sections = [
        {"label": title if not outline else f"第{index + 1}节", "url": url, "duration": seconds}
        for index, seconds in enumerate(durations or [0])
    ]
    return {
        "url": url,
        "title": title,
        "source": "example.com",
        "summary": summary,
        "body": "",
        "sections": sections,
        "has_outline": outline,
    }


class MaterialRouteTests(unittest.TestCase):
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
        video_draft_store.clear()
        self.client = TestClient(app)
        username = f"b5m-{os.urandom(4).hex()}"
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
        self.reads: list[str] = []
        self.advisor_calls = 0

        async def reader(url: str):
            self.reads.append(url)
            if url.endswith("/missing"):
                return None
            if url.endswith("/title"):
                return _link_material(url, title="只有标题", outline=False, summary="", durations=[0])
            if url.endswith("/video"):
                return _link_material(
                    url, title="线性代数课", outline=True, summary="讲秩", durations=[120, 0]
                )
            return _link_material(url, title="线性代数课", outline=True, summary="讲秩", durations=[180])

        async def advisor(_facts: str, _goal: dict) -> str:
            self.advisor_calls += 1
            raise RuntimeError("模型失败")

        app.dependency_overrides[get_link_reader] = lambda: reader
        app.dependency_overrides[get_material_advisor] = lambda: advisor

    def tearDown(self) -> None:
        app.dependency_overrides.pop(get_link_reader, None)
        app.dependency_overrides.pop(get_material_advisor, None)
        self.client.close()
        self.session.close()
        session_store.clear()
        material_comparison_store.clear()
        video_draft_store.clear()
        Base.metadata.drop_all(self.engine)

    def _doc(self, doc_id: str = "doc-la", content: str = "矩阵与秩", extra: str | None = "未纳入的行列式") -> None:
        rows = [
            UserDocument(
                user_id=self.user.id,
                doc_id=doc_id,
                filename="线性代数笔记.txt",
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
                    filename="线性代数笔记.txt",
                    file_type="txt",
                    chunk_index=1,
                    content=extra,
                )
            )
        self.session.add_all(rows)
        self.session.commit()

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

    def _compare(self, **extra: object):
        payload = {**GOAL, "documentIds": ["doc-la"], "links": ["https://example.com/course"]}
        payload.update(extra)
        return self.client.post("/api/materials/compare", json=payload)

    def _select(self, comparison_id: str, candidate_id: str, **extra: object):
        payload = {"candidateId": candidate_id, **GOAL}
        payload.update(extra)
        return self.client.post(f"/api/materials/comparisons/{comparison_id}/select", json=payload)

    def test_document_and_link_can_be_selected_without_a_model_or_plan(self) -> None:
        long_chunk = "矩" * 1000
        self._doc(content=long_chunk, extra="这次不该被当成没讲")
        before = self._counts()
        opened = self._compare(links=["https://example.com/video"])
        self.assertEqual(opened.status_code, 200, opened.text)
        body = opened.json()
        self.assertIsNone(body["planId"])
        self.assertEqual(body["suggestion"]["status"], "not_called")
        self.assertIsNone(body["suggestion"]["text"])
        self.assertEqual(self.advisor_calls, 0)
        kinds = {item["kind"]: item for item in body["candidates"]}
        self.assertEqual(set(kinds), {"document", "link"})
        document = kinds["document"]
        self.assertEqual(document["readStatus"], "read")
        self.assertEqual(document["facts"]["excerpts"][0]["content"], long_chunk)
        self.assertNotIn("这次不该被当成没讲", str(document["facts"]["excerpts"]))
        self.assertIn("没讲", document["facts"]["unreadNote"])
        self.assertEqual(document["facts"]["prerequisite"], "未知")
        link = kinds["link"]
        self.assertEqual(link["facts"]["duration"]["status"], "未知")
        self.assertNotIn("质量", link["facts"]["duration"]["note"])
        self.assertIn("播放", link["facts"]["duration"]["note"])
        chosen = self._select(body["comparisonId"], document["candidateId"])
        self.assertEqual(chosen.status_code, 200, chosen.text)
        self.assertEqual(chosen.json()["selectedCandidateId"], document["candidateId"])
        switched = self._select(body["comparisonId"], link["candidateId"])
        self.assertEqual(switched.status_code, 200, switched.text)
        self.assertEqual(switched.json()["selectedCandidateId"], link["candidateId"])
        self.assertEqual(self._counts(), before)

    def test_existing_plan_and_undo_target_stay_put(self) -> None:
        plan = Plan(
            user_id=self.user.id,
            goal_name=GOAL["goalName"],
            start_date=date(2026, 10, 11),
            goal_date=date(2027, 6, 30),
            current_level=GOAL["currentLevel"],
            daily_minutes=45,
            completion_criterion=None,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        phase = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="已有阶段",
            start_date=plan.start_date,
            end_date=plan.goal_date,
        )
        self.session.add(phase)
        self.session.flush()
        task = DailyTask(
            plan_id=plan.id,
            phase_id=phase.id,
            task_date=plan.start_date,
            week_label="W41",
            description="原任务",
            status="pending",
        )
        adjustment = PlanAdjustment(
            user_id=self.user.id,
            plan_id=plan.id,
            status="confirmed",
            instruction="原来的调整",
            basis_fingerprint="a" * 64,
            proposal={"selectionVersion": 1},
            diff={},
            validation={"ok": True},
            steps=[],
            decision_summary="已确认",
            evidence_refs=[],
            applied_record={"before": {"plan": {"goalName": GOAL["goalName"]}}},
        )
        self.session.add_all([task, adjustment])
        self.session.commit()
        self._doc(content="短正文", extra=None)
        opened = self._compare(planId=str(plan.id), links=["https://example.com/course"])
        self.assertEqual(opened.status_code, 200, opened.text)
        body = opened.json()
        self.assertEqual(body["planId"], str(plan.id))
        self.assertIsNone(body["goal"]["completionCriterion"])
        self.assertIn("未知", body["goal"]["completionCriterionLabel"])
        picked = next(item for item in body["candidates"] if item["kind"] == "document")
        chosen = self._select(body["comparisonId"], picked["candidateId"])
        self.assertEqual(chosen.status_code, 200, chosen.text)
        self.session.expire_all()
        stored = self.session.get(Plan, plan.id)
        self.assertEqual(stored.goal_name, GOAL["goalName"])
        self.assertIsNone(stored.completion_criterion)
        self.assertEqual(self.session.get(DailyTask, task.id).description, "原任务")
        self.assertEqual(self.session.get(PlanAdjustment, adjustment.id).status, "confirmed")
        self.assertEqual(self._counts()["adjustments"], 1)

    def test_new_flow_does_not_merge_an_old_link_draft(self) -> None:
        self._doc(content="短正文", extra=None)
        now = datetime.now(timezone.utc)
        video_draft_store.put(
            VideoDraft(
                user_id=self.user.id,
                material=_link_material(
                    "https://example.com/old", title="旧课", outline=True, summary="旧", durations=[60]
                ),
                url="https://example.com/old",
                suggested_start=suggest_start(now),
                created_at=now,
                pending_start=date(2026, 10, 12),
            )
        )
        opened = self._compare()
        body = opened.json()
        picked = body["candidates"][0]["candidateId"]
        chosen = self._select(
            body["comparisonId"],
            picked,
            message="确定",
            startDate="2026-10-12",
        )
        self.assertEqual(chosen.status_code, 200, chosen.text)
        self.assertEqual(self._counts()["tasks"], 0)
        draft = video_draft_store.get(self.user.id, now)
        self.assertEqual(draft.url, "https://example.com/old")
        self.assertIsNotNone(draft.material)

    def test_title_failure_truncation_and_model_failure_add_no_facts(self) -> None:
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
        self._doc(content="矩" * 1000)
        opened = self._compare(
            links=["https://example.com/title", "https://example.com/missing"]
        )
        self.assertEqual(opened.status_code, 200, opened.text)
        body = opened.json()
        by_status = {item["readStatus"]: item for item in body["candidates"] if item["kind"] == "link"}
        self.assertEqual(by_status["title_only"]["facts"]["coverage"], "未知")
        self.assertNotIn("章节", str(by_status["title_only"]["facts"]["excerpts"]))
        self.assertEqual(by_status["failed"]["facts"]["excerpts"], [])
        self.assertEqual(by_status["failed"]["facts"]["coverage"], "未知")
        self.assertEqual(body["suggestion"]["status"], "failed")
        self.assertIsNone(body["suggestion"]["text"])
        self.assertEqual(self.advisor_calls, 1)
        document = next(item for item in body["candidates"] if item["kind"] == "document")
        self.assertGreater(document["facts"]["unreadChunkCount"], 0)
        self.assertNotIn("没讲过", document["facts"]["coverage"])

    def test_stale_identity_goal_and_document_changes_are_rejected(self) -> None:
        self._doc()
        first = self._compare().json()
        second = self._compare(links=["https://example.com/video"]).json()
        stale = self._select(first["comparisonId"], first["candidates"][0]["candidateId"])
        self.assertEqual(stale.status_code, 404, stale.text)
        self.assertEqual(stale.json()["code"], "COMPARISON_NOT_FOUND")
        current = material_comparison_store.get(second["comparisonId"], self.user.id)
        current.created_at = datetime.now(timezone.utc) - timedelta(minutes=31)
        expired = self._select(second["comparisonId"], second["candidates"][0]["candidateId"])
        self.assertEqual(expired.status_code, 409, expired.text)
        self.assertEqual(expired.json()["code"], "COMPARISON_EXPIRED")

        fresh = self._compare().json()
        other = TestClient(app)
        other_name = f"other-{os.urandom(3).hex()}"
        self.assertEqual(
            other.post(
                "/api/auth/register",
                json={"username": other_name, "password": "placeholder-password"},
            ).status_code,
            201,
        )
        self.assertEqual(
            other.post(
                "/api/auth/login",
                json={"username": other_name, "password": "placeholder-password"},
            ).status_code,
            200,
        )
        foreign = other.post(
            f"/api/materials/comparisons/{fresh['comparisonId']}/select",
            json={"candidateId": fresh["candidates"][0]["candidateId"], **GOAL},
        )
        self.assertEqual(foreign.status_code, 404, foreign.text)
        other.close()

        changed_goal = self._select(
            fresh["comparisonId"],
            fresh["candidates"][0]["candidateId"],
            goalName="概率论入门",
        )
        self.assertEqual(changed_goal.status_code, 409, changed_goal.text)
        self.assertEqual(changed_goal.json()["code"], "GOAL_CHANGED")

        again = self._compare().json()
        row = self.session.scalar(
            select(UserDocument).where(UserDocument.doc_id == "doc-la", UserDocument.chunk_index == 0)
        )
        row.content = "正文已经改了"
        self.session.commit()
        changed_doc = self._select(again["comparisonId"], next(
            item["candidateId"] for item in again["candidates"] if item["kind"] == "document"
        ))
        self.assertEqual(changed_doc.status_code, 409, changed_doc.text)
        self.assertEqual(changed_doc.json()["code"], "SOURCE_CHANGED")
        self.assertIsNone(material_comparison_store.get(again["comparisonId"], self.user.id).selected_id)

        self.session.add(
            UserDocument(
                user_id=self.user.id,
                doc_id="doc-new",
                filename="线性代数笔记.txt",
                file_type="txt",
                chunk_index=0,
                content="同名新文件",
            )
        )
        self.session.commit()
        renamed = self._select(
            again["comparisonId"],
            next(item["candidateId"] for item in again["candidates"] if item["kind"] == "document"),
        )
        self.assertNotEqual(renamed.status_code, 200, renamed.text)

    def test_older_slow_comparison_cannot_replace_newer_one(self) -> None:
        async def interleave() -> None:
            entered = asyncio.Event()
            release = asyncio.Event()

            async def reader(url: str):
                if url.endswith("/old"):
                    entered.set()
                    await release.wait()
                return _link_material(url, title=url, outline=True, summary="read facts", durations=[60])

            async def run(url: str) -> dict:
                return await compare_materials(
                    self.session,
                    self.user.id,
                    goal=dict(GOAL),
                    plan_id=None,
                    document_ids=[],
                    links=[url],
                    link_reader=reader,
                    advisor=None,
                    has_model=False,
                )

            older = asyncio.create_task(run("https://example.com/old"))
            await entered.wait()
            newer = await run("https://example.com/new")
            release.set()
            old_result = await older
            self.assertIsNotNone(
                material_comparison_store.get(newer["comparisonId"], self.user.id)
            )
            self.assertIsNone(
                material_comparison_store.get(old_result["comparisonId"], self.user.id)
            )

        asyncio.run(interleave())

    def test_pending_new_comparison_rejects_old_selection(self) -> None:
        async def interleave() -> None:
            entered = asyncio.Event()
            release = asyncio.Event()

            async def reader(url: str):
                if url.endswith("/new"):
                    entered.set()
                    await release.wait()
                return _link_material(url, title=url, outline=True, summary="read facts", durations=[60])

            async def run(url: str) -> dict:
                return await compare_materials(
                    self.session,
                    self.user.id,
                    goal=dict(GOAL),
                    plan_id=None,
                    document_ids=[],
                    links=[url],
                    link_reader=reader,
                    advisor=None,
                    has_model=False,
                )

            previous = await run("https://example.com/old")
            newer = asyncio.create_task(run("https://example.com/new"))
            await entered.wait()
            with self.assertRaises(MaterialComparisonError) as caught:
                select_material(
                    self.session,
                    self.user.id,
                    previous["comparisonId"],
                    previous["candidates"][0]["candidateId"],
                    dict(GOAL),
                )
            self.assertEqual(caught.exception.code, "COMPARISON_NOT_FOUND")
            stored = material_comparison_store._by_id[previous["comparisonId"]]
            self.assertIsNone(stored.selected_id)
            release.set()
            new_result = await newer
            chosen = select_material(
                self.session,
                self.user.id,
                new_result["comparisonId"],
                new_result["candidates"][0]["candidateId"],
                dict(GOAL),
            )
            self.assertEqual(chosen["selectedCandidateId"], new_result["candidates"][0]["candidateId"])
            with self.assertRaises(MaterialComparisonError):
                select_material(
                    self.session,
                    self.user.id,
                    previous["comparisonId"],
                    previous["candidates"][0]["candidateId"],
                    dict(GOAL),
                )

        asyncio.run(interleave())

    def test_missing_or_foreign_document_cannot_be_selected(self) -> None:
        other = User(username=f"owner-{os.urandom(3).hex()}", password_hash="not-used")
        self.session.add(other)
        self.session.flush()
        self.session.add(
            UserDocument(
                user_id=other.id,
                doc_id="foreign-doc",
                filename="foreign.txt",
                file_type="txt",
                chunk_index=0,
                content="private source text",
            )
        )
        self.session.commit()
        foreign = self._compare(documentIds=["foreign-doc"], links=[])
        self.assertEqual(foreign.status_code, 200, foreign.text)
        foreign_body = foreign.json()
        self.assertEqual(foreign_body["candidates"][0]["readStatus"], "failed")
        selected = self._select(
            foreign_body["comparisonId"], foreign_body["candidates"][0]["candidateId"]
        )
        self.assertNotEqual(selected.status_code, 200, selected.text)
        self.assertIsNone(
            material_comparison_store.get(foreign_body["comparisonId"], self.user.id).selected_id
        )

        missing = self._compare(documentIds=["missing-doc"], links=[]).json()
        missing_choice = self._select(missing["comparisonId"], missing["candidates"][0]["candidateId"])
        self.assertNotEqual(missing_choice.status_code, 200, missing_choice.text)
        self.assertIsNone(
            material_comparison_store.get(missing["comparisonId"], self.user.id).selected_id
        )

    def test_deleted_document_is_not_reattached_by_name(self) -> None:
        self._doc(content="可选择的正文", extra=None)
        opened = self._compare(links=[]).json()
        document = next(item for item in opened["candidates"] if item["kind"] == "document")
        self.assertEqual(document["readStatus"], "read")
        self.session.query(UserDocument).filter(UserDocument.doc_id == "doc-la").delete()
        self.session.commit()
        self.session.add(
            UserDocument(
                user_id=self.user.id,
                doc_id="doc-renamed",
                filename="线性代数笔记.txt",
                file_type="txt",
                chunk_index=0,
                content="可选择的正文",
            )
        )
        self.session.commit()
        chosen = self._select(opened["comparisonId"], document["candidateId"])
        self.assertNotEqual(chosen.status_code, 200, chosen.text)
        self.assertIsNone(
            material_comparison_store.get(opened["comparisonId"], self.user.id).selected_id
        )

    def test_title_only_choice_states_it_has_no_body(self) -> None:
        opened = self._compare(documentIds=[], links=["https://example.com/title"]).json()
        title = opened["candidates"][0]
        self.assertEqual(title["readStatus"], "title_only")
        chosen = self._select(opened["comparisonId"], title["candidateId"])
        self.assertEqual(chosen.status_code, 200, chosen.text)
        body = chosen.json()
        self.assertEqual(body["selectedCandidateId"], title["candidateId"])
        note = body["candidates"][0]["facts"].get("basisNote", "")
        self.assertIn("没有正文", note)
        self.assertIn("章节", note)
        self.assertFalse(body["candidates"][0]["usableSource"])

    def test_default_advisor_uses_fake_transport_for_this_snapshot_only(self) -> None:
        self.session.add(
            ApiConfig(
                user_id=self.user.id,
                api_key_cipher=encrypt("temporary-test-key"),
                model_type="gpt",
                base_url="https://example.invalid/v1",
                is_verified=True,
            )
        )
        self.session.add(
            UserDocument(
                user_id=self.user.id,
                doc_id="not-in-this-compare",
                filename="别的资料.txt",
                file_type="txt",
                chunk_index=0,
                content="这份不在本次比较里的私密正文",
            )
        )
        self.session.commit()
        app.dependency_overrides.pop(get_material_advisor, None)
        captured: list[dict] = []

        class _Lines:
            status_code = 200

            async def aiter_lines(self):
                payload = {
                    "choices": [
                        {"delta": {"content": "先修未知。覆盖只来自本次摘录。"}}
                    ]
                }
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
                captured.append({"method": method, "url": url, "json": json})
                return _Stream()

        with patch("httpx.AsyncClient", _Client):
            opened = self._compare(documentIds=[], links=["https://example.com/course"])
        self.assertEqual(opened.status_code, 200, opened.text)
        body = opened.json()
        self.assertEqual(body["suggestion"]["status"], "suggested")
        self.assertIn("本次摘录", body["suggestion"]["text"])
        self.assertEqual(len(captured), 1)
        sent = json.dumps(captured[0]["json"], ensure_ascii=False)
        self.assertIn("https://example.com/course", sent)
        self.assertIn(GOAL["goalName"], sent)
        self.assertIn("180", sent)
        self.assertNotIn("这份不在本次比较里的私密正文", sent)
        self.assertNotIn("temporary-test-key", sent)

        app.dependency_overrides.pop(get_material_advisor, None)
        with patch("httpx.AsyncClient", side_effect=RuntimeError("blocked transport")):
            failed = self._compare(documentIds=[], links=["https://example.com/course"])
        self.assertEqual(failed.status_code, 200, failed.text)
        failed_body = failed.json()
        self.assertEqual(failed_body["suggestion"]["status"], "failed")
        self.assertIsNone(failed_body["suggestion"]["text"])
        self.assertTrue(failed_body["candidates"])

    def test_compare_and_select_reject_coerced_minutes(self) -> None:
        self._doc(content="短正文", extra=None)
        for value in (True, "45", 45.0):
            with self.subTest(value=value):
                opened = self._compare(dailyMinutes=value)
                self.assertNotEqual(opened.status_code, 200, opened.text)
                chosen = self._select("missing-comparison", "doc:doc-la", dailyMinutes=value)
                self.assertNotEqual(chosen.status_code, 200, chosen.text)
