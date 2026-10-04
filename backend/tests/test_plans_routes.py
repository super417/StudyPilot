import base64
import json
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
from app.models.entities import ApiConfig, DailyTask, Phase, Plan, User, UserDocument
from app.routers.plans import get_plan_generator
from app.services.session_service import session_store


def _plan_structure(phase_count: int = 3) -> dict:
    return {
        "phases": [
            {
                "name": f"阶段 {i + 1}",
                "start_date": "2025-01-01",
                "end_date": "2025-02-01",
                "daily_tasks": [
                    {
                        "task_date": "2025-01-01",
                        "week_label": "W01",
                        "description": f"阶段{i + 1}任务",
                    }
                ],
            }
            for i in range(phase_count)
        ]
    }


def _parse_sse(text: str) -> list[tuple[str, str]]:
    """Return a list of (event, data) pairs from an SSE response body."""
    events: list[tuple[str, str]] = []
    event = None
    for line in text.splitlines():
        if line.startswith("event: "):
            event = line[len("event: ") :]
        elif line.startswith("data: ") and event is not None:
            events.append((event, line[len("data: ") :]))
            event = None
    return events


class PlanRouteTests(unittest.TestCase):
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
        username = f"plan-route-{os.urandom(8).hex()}"
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
        app.dependency_overrides.pop(get_plan_generator, None)
        self.client.close()
        self.session.close()
        session_store.clear()
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

    def _override_generator(self, phase_count: int = 3) -> None:
        def factory():
            def generator(fields, used_docs, context_text, instruction):
                return _plan_structure(phase_count)

            return generator

        app.dependency_overrides[get_plan_generator] = factory

    def _add_ready_document(self, doc_id: str, content: str = "chunk text") -> None:
        self.session.add(
            UserDocument(
                user_id=self.user.id,
                doc_id=doc_id,
                filename=f"{doc_id}.txt",
                file_type="txt",
                chunk_index=0,
                content=content,
            )
        )
        self.session.commit()

    def _plans(self) -> list[Plan]:
        self.session.expire_all()
        return list(
            self.session.scalars(select(Plan).where(Plan.user_id == self.user.id))
        )

    def test_generate_missing_fields_emits_clarify_with_draft_id(self) -> None:
        response = self.client.post(
            "/api/plans/generate",
            json={"goalName": "考研数学"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        events = _parse_sse(response.text)
        self.assertEqual(len(events), 1)
        event, data = events[0]
        self.assertEqual(event, "clarify")
        self.assertIn("draftId", data)
        self.assertIn("goalDate", data)
        self.assertEqual(self._plans(), [])

    def test_generate_complete_emits_done_and_persists(self) -> None:
        self._add_verified_config()
        self._add_ready_document("doc_a")
        self._override_generator(phase_count=4)
        response = self.client.post(
            "/api/plans/generate",
            json={
                "goalName": "考研数学",
                "goalDate": "2025-12-21",
                "currentLevel": "零基础",
                "dailyMinutes": 120,
                "documentIds": ["doc_a"],
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        events = _parse_sse(response.text)
        self.assertEqual([e for e, _ in events], ["done"])
        _, data = events[0]
        self.assertIn("planId", data)
        self.assertIn('"phases": 4', data)
        self.assertIn('"doc_a"', data)

        plans = self._plans()
        self.assertEqual(len(plans), 1)
        phases = list(
            self.session.scalars(
                select(Phase).where(Phase.plan_id == plans[0].id)
            )
        )
        self.assertEqual(len(phases), 4)
        tasks = list(
            self.session.scalars(
                select(DailyTask).where(DailyTask.plan_id == plans[0].id)
            )
        )
        # 2025-01-01..2025-02-01 inclusive is 32 days, filled per phase.
        self.assertEqual(len(tasks), 4 * 32)

    def test_generate_without_api_config_emits_no_api_key(self) -> None:
        self._override_generator()
        response = self.client.post(
            "/api/plans/generate",
            json={
                "goalName": "考研数学",
                "goalDate": "2025-12-21",
                "currentLevel": "零基础",
                "dailyMinutes": 120,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        events = _parse_sse(response.text)
        self.assertEqual([e for e, _ in events], ["error"])
        self.assertIn("NO_API_KEY", events[0][1])
        self.assertEqual(self._plans(), [])

    def test_clarify_completes_draft_and_generates(self) -> None:
        self._add_verified_config()
        self._override_generator(phase_count=2)
        generate = self.client.post(
            "/api/plans/generate", json={"goalName": "考研数学"}
        )
        _, clarify_data = _parse_sse(generate.text)[0]
        import json

        draft_id = json.loads(clarify_data)["draftId"]

        response = self.client.post(
            f"/api/plans/{draft_id}/clarify",
            json={
                "goalDate": "2025-12-21",
                "currentLevel": "零基础",
                "dailyMinutes": 120,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        events = _parse_sse(response.text)
        self.assertEqual([e for e, _ in events], ["done"])
        self.assertEqual(len(self._plans()), 1)

    def test_clarify_unknown_draft_emits_error(self) -> None:
        self._add_verified_config()
        self._override_generator()
        response = self.client.post(
            "/api/plans/does-not-exist/clarify",
            json={"goalName": "考研数学"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        events = _parse_sse(response.text)
        self.assertEqual([e for e, _ in events], ["error"])
        self.assertIn("DRAFT_NOT_FOUND", events[0][1])

    def test_generate_emits_notice_for_skipped_docs_before_done(self) -> None:
        self._add_verified_config()
        self._add_ready_document("doc_ready")
        self._override_generator(phase_count=3)
        response = self.client.post(
            "/api/plans/generate",
            json={
                "goalName": "考研数学",
                "goalDate": "2025-12-21",
                "currentLevel": "零基础",
                "dailyMinutes": 120,
                "documentIds": ["doc_ready", "doc_missing"],
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        events = _parse_sse(response.text)
        self.assertEqual([e for e, _ in events], ["notice", "done"])
        import json

        notice = json.loads(events[0][1])
        self.assertEqual(notice["skippedDocs"], ["doc_missing"])
        self.assertIn("尚未就绪", notice["message"])
        done = json.loads(events[1][1])
        self.assertEqual(done["usedDocs"], ["doc_ready"])

    def test_generate_all_docs_unready_still_generates_after_notice(self) -> None:
        self._add_verified_config()
        self._override_generator(phase_count=2)
        response = self.client.post(
            "/api/plans/generate",
            json={
                "goalName": "考研数学",
                "goalDate": "2025-12-21",
                "currentLevel": "零基础",
                "dailyMinutes": 120,
                "documentIds": ["doc_x", "doc_y"],
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        events = _parse_sse(response.text)
        self.assertEqual([e for e, _ in events], ["notice", "done"])
        import json

        notice = json.loads(events[0][1])
        self.assertEqual(notice["skippedDocs"], ["doc_x", "doc_y"])
        done = json.loads(events[1][1])
        self.assertEqual(done["usedDocs"], [])
        self.assertEqual(len(self._plans()), 1)

    def test_generate_without_document_ids_emits_no_notice(self) -> None:
        self._add_verified_config()
        self._override_generator(phase_count=2)
        response = self.client.post(
            "/api/plans/generate",
            json={
                "goalName": "考研数学",
                "goalDate": "2025-12-21",
                "currentLevel": "零基础",
                "dailyMinutes": 120,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        events = _parse_sse(response.text)
        self.assertEqual([e for e, _ in events], ["done"])

    def test_empty_documents_ask_until_clear_then_save_on_confirm(self) -> None:
        from app.services.plan_draft_store import plan_draft_store

        plan_draft_store.clear()
        self._add_verified_config()
        self._override_generator(phase_count=2)
        goal = {
            "goalName": "考研",
            "goalDate": "2025-12-21",
            "currentLevel": "零基础",
            "dailyMinutes": 120,
            "documentIds": [],
        }
        opened = self.client.post("/api/plans/generate", json=goal)
        self.assertEqual(opened.status_code, 200, opened.text)
        events = _parse_sse(opened.text)
        self.assertEqual([e for e, _ in events], ["clarify"])
        clarify = json.loads(events[0][1])
        self.assertNotIn("不够具体", clarify["question"])
        self.assertEqual(self._plans(), [])

        vague = self.client.post(
            f"/api/plans/{clarify['draftId']}/clarify",
            json={"message": "考研"},
        )
        self.assertEqual([e for e, _ in _parse_sse(vague.text)], ["clarify"])
        self.assertEqual(self._plans(), [])
        for _ in range(3):
            still = self.client.post(
                f"/api/plans/{clarify['draftId']}/clarify",
                json={"message": "随便"},
            )
            self.assertEqual([e for e, _ in _parse_sse(still.text)], ["clarify"])
        self.assertEqual(self._plans(), [])

        preview = self.client.post(
            f"/api/plans/{clarify['draftId']}/clarify",
            json={"message": "我想学完武忠祥的2028高数二一整本书"},
        )
        preview_events = _parse_sse(preview.text)
        self.assertEqual([e for e, _ in preview_events], ["preview"])
        summary = json.loads(preview_events[0][1])["summary"]
        self.assertIn("武忠祥", summary)
        self.assertNotIn("不够具体", summary)
        self.assertIn("确定", summary)
        self.assertEqual(self._plans(), [])

        saved = self.client.post(
            f"/api/plans/{clarify['draftId']}/clarify",
            json={"message": "确定"},
        )
        saved_events = _parse_sse(saved.text)
        self.assertEqual([e for e, _ in saved_events], ["done"])
        self.assertEqual(len(self._plans()), 1)
        self.assertEqual(json.loads(saved_events[0][1])["phases"], 2)

    def test_form_book_title_previews_without_demanding_chapters(self) -> None:
        from app.services.plan_draft_store import plan_draft_store

        plan_draft_store.clear()
        self._add_verified_config()
        self._override_generator(phase_count=2)
        opened = self.client.post(
            "/api/plans/generate",
            json={
                "goalName": "我想要学习武忠祥的2028高数二一整本书",
                "goalDate": "2026-12-31",
                "currentLevel": "一年前学过",
                "dailyMinutes": 120,
                "documentIds": [],
            },
        )
        events = _parse_sse(opened.text)
        self.assertEqual([event for event, _ in events], ["preview"])
        summary = json.loads(events[0][1])["summary"]
        self.assertIn("武忠祥", summary)
        self.assertNotIn("不够具体", summary)
        self.assertEqual(self._plans(), [])

        parallel = self.client.post(
            "/api/plans/generate",
            json={
                "goalName": "接下来3个月同时学数学、英语、政治",
                "goalDate": "2026-12-31",
                "currentLevel": "零基础",
                "dailyMinutes": 120,
                "documentIds": [],
            },
        )
        parallel_events = _parse_sse(parallel.text)
        self.assertEqual([event for event, _ in parallel_events], ["preview"])
        self.assertIn("数学", json.loads(parallel_events[0][1])["summary"])

        shrug = self.client.post(
            "/api/plans/generate",
            json={
                "goalName": "考研",
                "goalDate": "2026-12-31",
                "currentLevel": "一年前学过",
                "dailyMinutes": 120,
                "documentIds": [],
            },
        )
        shrug_events = _parse_sse(shrug.text)
        draft_id = json.loads(shrug_events[0][1])["draftId"]
        filled = self.client.post(
            f"/api/plans/{draft_id}/clarify",
            json={
                "goalName": "我想要学习武忠祥的2028高数二一整本书",
                "goalDate": "2026-12-31",
                "currentLevel": "一年前学过",
                "dailyMinutes": 120,
            },
        )
        filled_events = _parse_sse(filled.text)
        self.assertEqual([event for event, _ in filled_events], ["preview"])
        self.assertIn("武忠祥", json.loads(filled_events[0][1])["summary"])
        self.assertEqual(self._plans(), [])

    def test_unauthenticated_generate_returns_401(self) -> None:
        self.client.cookies.clear()
        response = self.client.post(
            "/api/plans/generate",
            json={
                "goalName": "考研数学",
                "goalDate": "2025-12-21",
                "currentLevel": "零基础",
                "dailyMinutes": 120,
            },
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "UNAUTHENTICATED")

    # --- 19.1 regenerate ----------------------------------------------------

    def _seed_plan(self, phase_count: int = 3):
        """Persist one plan via the generate route and return its plan id."""
        self._add_verified_config()
        self._override_generator(phase_count=phase_count)
        response = self.client.post(
            "/api/plans/generate",
            json={
                "goalName": "考研数学",
                "goalDate": "2025-12-21",
                "currentLevel": "零基础",
                "dailyMinutes": 120,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        events = _parse_sse(response.text)
        return json.loads(events[-1][1])["planId"]

    def test_regenerate_updates_plan_in_place_and_rebuilds_children(self) -> None:
        plan_id = self._seed_plan(phase_count=5)
        original = self.session.scalar(select(Plan).where(Plan.id == uuid.UUID(plan_id)))
        original_id = original.id

        self._override_generator(phase_count=2)
        response = self.client.post(
            f"/api/plans/{plan_id}/regenerate",
            json={"message": "阶段太多了，压缩成两个阶段", "dailyMinutes": 240},
        )
        self.assertEqual(response.status_code, 200, response.text)
        events = _parse_sse(response.text)
        self.assertEqual([e for e, _ in events], ["done"])
        done = json.loads(events[0][1])

        # Same plan id: the record was updated, not replaced (需求 10.2).
        self.assertEqual(done["planId"], plan_id)
        self.assertEqual(done["phases"], 2)

        self.session.expire_all()
        refreshed = self.session.scalar(select(Plan).where(Plan.id == original_id))
        self.assertIsNotNone(refreshed)
        self.assertEqual(refreshed.total_phases, 2)
        self.assertEqual(refreshed.daily_minutes, 240)
        # Unspecified fields are carried over, never blanked by a vague edit.
        self.assertEqual(refreshed.goal_name, "考研数学")
        self.assertEqual(refreshed.current_level, "零基础")

        phases = list(
            self.session.scalars(
                select(Phase).where(Phase.plan_id == original_id).order_by(Phase.phase_index)
            )
        )
        self.assertEqual([p.phase_index for p in phases], [1, 2])
        tasks = list(
            self.session.scalars(select(DailyTask).where(DailyTask.plan_id == original_id))
        )
        self.assertEqual(len(tasks), 2 * 32)  # 2 phases, every day 2025-01-01..02-01
        self.assertEqual(len(set(t.phase_id for t in tasks)), 2)

    def test_regenerate_passes_instruction_to_generator(self) -> None:
        plan_id = self._seed_plan(phase_count=2)
        captured: dict = {}

        def factory():
            def generator(fields, used_docs, context_text, instruction):
                captured["instruction"] = instruction
                captured["fields"] = dict(fields)
                return _plan_structure(2)

            return generator

        app.dependency_overrides[get_plan_generator] = factory
        response = self.client.post(
            f"/api/plans/{plan_id}/regenerate",
            json={"message": "把每天时间改成 3 小时", "dailyMinutes": 180},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(captured["instruction"], "把每天时间改成 3 小时")
        self.assertEqual(captured["fields"]["dailyMinutes"], 180)

    def test_regenerate_unknown_plan_emits_plan_not_found(self) -> None:
        self._add_verified_config()
        self._override_generator(phase_count=2)
        response = self.client.post(
            f"/api/plans/{uuid.uuid4()}/regenerate",
            json={"message": "重新来过"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        events = _parse_sse(response.text)
        self.assertEqual([e for e, _ in events], ["error"])
        self.assertIn("PLAN_NOT_FOUND", events[0][1])

    def test_regenerate_malformed_plan_id_emits_plan_not_found(self) -> None:
        self._add_verified_config()
        response = self.client.post(
            "/api/plans/not-a-uuid/regenerate",
            json={"message": "重新来过"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        events = _parse_sse(response.text)
        self.assertEqual([e for e, _ in events], ["error"])
        self.assertIn("PLAN_NOT_FOUND", events[0][1])

    def test_regenerate_without_config_emits_no_api_key(self) -> None:
        plan_id = self._seed_plan(phase_count=2)
        self.session.query(ApiConfig).filter(
            ApiConfig.user_id == self.user.id
        ).delete(synchronize_session=False)
        self.session.commit()

        response = self.client.post(
            f"/api/plans/{plan_id}/regenerate",
            json={"message": "重新来过"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        events = _parse_sse(response.text)
        self.assertEqual([e for e, _ in events], ["error"])
        self.assertIn("NO_API_KEY", events[0][1])

    def test_regenerate_with_empty_request_emits_error(self) -> None:
        plan_id = self._seed_plan(phase_count=2)
        response = self.client.post(
            f"/api/plans/{plan_id}/regenerate",
            json={},
        )
        self.assertEqual(response.status_code, 200, response.text)
        events = _parse_sse(response.text)
        self.assertEqual([e for e, _ in events], ["error"])

    def test_regenerate_reports_skipped_docs_before_done(self) -> None:
        plan_id = self._seed_plan(phase_count=2)
        self._add_ready_document("doc_ready")
        self._override_generator(phase_count=2)
        response = self.client.post(
            f"/api/plans/{plan_id}/regenerate",
            json={"message": "参考新文档重排", "documentIds": ["doc_ready", "doc_gone"]},
        )
        self.assertEqual(response.status_code, 200, response.text)
        events = _parse_sse(response.text)
        self.assertEqual([e for e, _ in events], ["notice", "done"])
        self.assertEqual(json.loads(events[0][1])["skippedDocs"], ["doc_gone"])
        self.assertEqual(json.loads(events[1][1])["usedDocs"], ["doc_ready"])

    # --- 19.1 phase PATCH ---------------------------------------------------

    def test_patch_phase_updates_only_that_phase(self) -> None:
        plan_id = self._seed_plan(phase_count=3)
        phases = list(
            self.session.scalars(
                select(Phase)
                .where(Phase.plan_id == uuid.UUID(plan_id))
                .order_by(Phase.phase_index)
            )
        )
        target = phases[1]
        others_before = {
            p.id: (p.name, p.start_date, p.end_date, p.progress_percent, p.is_current)
            for p in phases
            if p.id != target.id
        }

        response = self.client.patch(
            f"/api/phases/{target.id}",
            json={"name": "强化二 · 线性代数", "endDate": "2025-04-01"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["phase"]["name"], "强化二 · 线性代数")
        self.assertEqual(body["phase"]["endDate"], "2025-04-01")
        # startDate was omitted: untouched, not cleared.
        self.assertEqual(body["phase"]["startDate"], target.start_date.isoformat())

        self.session.expire_all()
        after = list(
            self.session.scalars(
                select(Phase)
                .where(Phase.plan_id == uuid.UUID(plan_id))
                .order_by(Phase.phase_index)
            )
        )
        for phase in after:
            if phase.id == target.id:
                continue
            self.assertEqual(
                others_before[phase.id],
                (
                    phase.name,
                    phase.start_date,
                    phase.end_date,
                    phase.progress_percent,
                    phase.is_current,
                ),
            )

    def test_patch_phase_does_not_require_api_config(self) -> None:
        """A card tweak is a plain REST edit — no AI call, so no NO_API_KEY."""
        plan_id = self._seed_plan(phase_count=2)
        self.session.query(ApiConfig).filter(
            ApiConfig.user_id == self.user.id
        ).delete(synchronize_session=False)
        self.session.commit()

        phase = self.session.scalar(
            select(Phase).where(Phase.plan_id == uuid.UUID(plan_id))
        )
        response = self.client.patch(
            f"/api/phases/{phase.id}", json={"name": "微调后"}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["phase"]["name"], "微调后")

    def test_patch_unknown_phase_returns_404(self) -> None:
        response = self.client.patch(
            f"/api/phases/{uuid.uuid4()}", json={"name": "x"}
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "PHASE_NOT_FOUND")

    def test_patch_malformed_phase_id_returns_404(self) -> None:
        response = self.client.patch("/api/phases/not-a-uuid", json={"name": "x"})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "PHASE_NOT_FOUND")

    def test_patch_another_users_phase_returns_404(self) -> None:
        """A foreign phase must look exactly like an unknown one (no leakage)."""
        plan_id = self._seed_plan(phase_count=2)
        foreign_plan = Plan(
            user_id=uuid.uuid4(),
            goal_name="别人的规划",
            start_date=date(2025, 1, 1),
            goal_date=date(2025, 12, 31),
            current_level="未知",
            daily_minutes=60,
            total_phases=2,
        )
        self.session.add(foreign_plan)
        self.session.flush()
        foreign_phase = Phase(
            plan_id=foreign_plan.id,
            phase_index=1,
            name="别人的阶段",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 2, 1),
        )
        self.session.add(foreign_phase)
        self.session.commit()

        response = self.client.patch(
            f"/api/phases/{foreign_phase.id}", json={"name": "篡改"}
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "PHASE_NOT_FOUND")

    def test_patch_phase_unauthenticated_returns_401(self) -> None:
        plan_id = self._seed_plan(phase_count=2)
        phase = self.session.scalar(
            select(Phase).where(Phase.plan_id == uuid.UUID(plan_id))
        )
        self.client.cookies.clear()
        response = self.client.patch(f"/api/phases/{phase.id}", json={"name": "x"})
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
