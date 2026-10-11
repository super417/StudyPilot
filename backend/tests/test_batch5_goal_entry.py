"""第五批第 1 子批：目标入口、完成标准、调整兼容。注入生成器，不调用模型。"""

import base64
import json
import os
import tempfile
import unittest
import uuid
from datetime import timedelta
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.clock import local_today
from app.core.config import get_settings
from app.core.crypto import get_cipher
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
from app.routers.plans import get_plan_generator
from app.services import adjustment_service, planner_service
from app.services.plan_draft_store import MAX_CLARIFY_ROUNDS, PlanDraft, plan_draft_store
from app.services.planner_service import (
    ClarifyOutcome,
    GenerateOutcome,
    advance_state,
    missing_fields,
)
from app.services.session_service import session_store

FUTURE = "2027-06-30"
CRITERION = "能独立证明秩不等式"
GOAL = "线性代数入门"


def _structure() -> dict:
    return {
        "phases": [
            {
                "name": "阶段 1",
                "start_date": FUTURE,
                "end_date": FUTURE,
                "daily_tasks": [
                    {
                        "task_date": FUTURE,
                        "week_label": "W01",
                        "description": "线性代数：证明秩不等式，写出步骤",
                        "estimated_minutes": 30,
                    }
                ],
            },
            {
                "name": "阶段 2",
                "start_date": FUTURE,
                "end_date": FUTURE,
                "daily_tasks": [
                    {
                        "task_date": FUTURE,
                        "week_label": "W01",
                        "description": "线性代数：复述证明，整理 1 道错例",
                        "estimated_minutes": 30,
                    }
                ],
            },
        ]
    }


def _parse_sse(body: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    event = None
    for line in body.splitlines():
        if line.startswith("event: "):
            event = line[len("event: ") :]
        elif line.startswith("data: ") and event is not None:
            events.append((event, json.loads(line[len("data: ") :])))
            event = None
    return events


def _complete(**overrides: object) -> dict:
    payload: dict[str, object] = {
        "goalName": GOAL,
        "goalDate": FUTURE,
        "currentLevel": "学过矩阵",
        "dailyMinutes": 45,
        "completionCriterion": CRITERION,
    }
    payload.update(overrides)
    return payload


class GoalFieldTests(unittest.TestCase):
    def test_new_goal_requires_criterion_and_clear_object(self) -> None:
        payload = _complete()
        del payload["completionCriterion"]
        self.assertIn("completionCriterion", missing_fields(payload))
        vague = _complete(goalName="考研")
        self.assertEqual(missing_fields(vague), ["goalName"])

    def test_compact_past_and_non_integer_minutes_are_not_ready(self) -> None:
        self.assertIn("goalDate", missing_fields(_complete(goalDate="20270630")))
        self.assertIn(
            "goalDate",
            missing_fields(_complete(goalDate=(local_today() - timedelta(days=1)).isoformat())),
        )
        self.assertEqual(missing_fields(_complete()), [])
        for bad in (12.5, True, 0, "45"):
            self.assertIn("dailyMinutes", missing_fields(_complete(dailyMinutes=bad)))

    def test_round_cap_stops_without_generating(self) -> None:
        draft = PlanDraft(user_id=uuid.uuid4(), fields={"goalName": GOAL}, round=1)
        seen: list[ClarifyOutcome] = []
        for _ in range(6):
            outcome = advance_state(draft, {})
            self.assertNotIsInstance(outcome, GenerateOutcome)
            self.assertIsInstance(outcome, ClarifyOutcome)
            seen.append(outcome)
            self.assertLessEqual(outcome.round, MAX_CLARIFY_ROUNDS)
        self.assertTrue(seen[-1].stopped)
        self.assertIn("completionCriterion", seen[-1].missing)

    def test_prompt_keeps_user_criterion_and_drops_kaoyan_subject_lock(self) -> None:
        fields = _complete()
        prompt = planner_service._build_plan_user_prompt(fields, [], "", "")
        self.assertIn(GOAL, prompt)
        self.assertIn(CRITERION, prompt)
        self.assertIn("用户完成标准", prompt)
        self.assertNotIn("考研目标", prompt)
        self.assertNotIn("面向考研", planner_service._PLAN_SYSTEM_PROMPT)
        self.assertNotIn("考研学习规划助手", planner_service._PLAN_SYSTEM_PROMPT)


class GoalRouteTests(unittest.TestCase):
    calls = 0

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
        plan_draft_store.clear()
        GoalRouteTests.calls = 0
        username = f"b5-{os.urandom(6).hex()}"
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

        def factory():
            def generator(fields, used_docs, context_text, instruction):
                GoalRouteTests.calls += 1
                return _structure()

            return generator

        app.dependency_overrides[get_plan_generator] = factory

    def tearDown(self) -> None:
        app.dependency_overrides.pop(get_plan_generator, None)
        self.client.close()
        self.session.close()
        session_store.clear()
        plan_draft_store.clear()
        Base.metadata.drop_all(self.engine)

    def _verify(self) -> None:
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

    def _plans(self) -> list[Plan]:
        self.session.expire_all()
        return list(self.session.scalars(select(Plan).where(Plan.user_id == self.user.id)))

    def _doc(self) -> None:
        self.session.add(
            UserDocument(
                user_id=self.user.id,
                doc_id="doc-la",
                filename="la.txt",
                file_type="txt",
                chunk_index=0,
                content="秩不等式",
            )
        )
        self.session.commit()

    def test_three_entries_do_not_generate_when_incomplete_or_capped(self) -> None:
        self._verify()
        self._doc()

        form = self.client.post("/api/plans/generate", json=_complete(goalName="考研"))
        self.assertEqual([name for name, _ in _parse_sse(form.text)], ["clarify"])
        self.assertEqual(self._plans(), [])
        self.assertEqual(GoalRouteTests.calls, 0)

        with_doc = self.client.post(
            "/api/plans/generate",
            json=_complete(completionCriterion=None, documentIds=["doc-la"]),
        )
        opened = _parse_sse(with_doc.text)
        self.assertEqual([name for name, _ in opened], ["clarify"])
        draft_id = opened[0][1]["draftId"]
        for _ in range(MAX_CLARIFY_ROUNDS):
            step = self.client.post(f"/api/plans/{draft_id}/clarify", json={"message": "随便"})
            self.assertEqual([name for name, _ in _parse_sse(step.text)], ["clarify"])
        last = _parse_sse(step.text)[-1][1]
        self.assertTrue(last.get("stopped"))
        self.assertEqual(self._plans(), [])
        self.assertEqual(GoalRouteTests.calls, 0)

        no_file = self.client.post(
            "/api/plans/generate",
            json=_complete(goalName="学习", documentIds=[]),
        )
        vague = _parse_sse(no_file.text)
        self.assertEqual([name for name, _ in vague], ["clarify"])
        no_file_id = vague[0][1]["draftId"]
        stopped = None
        for _ in range(6):
            step = self.client.post(
                f"/api/plans/{no_file_id}/clarify",
                json={"message": "随便"},
            )
            stopped = _parse_sse(step.text)[-1][1]
            self.assertLessEqual(stopped["round"], MAX_CLARIFY_ROUNDS)
        self.assertTrue(stopped.get("stopped"))
        self.assertEqual(GoalRouteTests.calls, 0)
        self.assertEqual(self._plans(), [])

    def test_date_or_minutes_reply_does_not_replace_goal_but_correction_does(self) -> None:
        self._verify()
        opened = self.client.post(
            "/api/plans/generate",
            json=_complete(goalName="学习", documentIds=[]),
        )
        draft_id = _parse_sse(opened.text)[0][1]["draftId"]
        named = self.client.post(
            f"/api/plans/{draft_id}/clarify",
            json={"message": GOAL},
        )
        self.assertEqual([name for name, _ in _parse_sse(named.text)], ["preview"])
        dated = self.client.post(
            f"/api/plans/{draft_id}/clarify",
            json={"message": "2027-08-01"},
        )
        self.assertNotIn("2027-08-01", _parse_sse(dated.text)[0][1]["summary"].split("排了")[0])
        self.assertIn(GOAL, _parse_sse(dated.text)[0][1]["summary"])
        saved = self.client.post(
            f"/api/plans/{draft_id}/clarify",
            json={"message": "确定"},
        )
        self.assertEqual([name for name, _ in _parse_sse(saved.text)], ["done"])
        plan = self._plans()[0]
        self.assertEqual(plan.goal_name, GOAL)
        self.assertEqual(plan.goal_date.isoformat(), "2027-08-01")
        self.assertEqual(plan.completion_criterion, CRITERION)

        again = self.client.post(
            "/api/plans/generate",
            json=_complete(documentIds=[]),
        )
        second = _parse_sse(again.text)[0][1]["draftId"]
        self.client.post(f"/api/plans/{second}/clarify", json={"message": "改学概率论"})
        confirmed = self.client.post(
            f"/api/plans/{second}/clarify",
            json={"message": "确定"},
        )
        self.assertEqual([name for name, _ in _parse_sse(confirmed.text)], ["done"])
        renamed = [row for row in self._plans() if row.goal_name == "概率论"]
        self.assertEqual(len(renamed), 1)
        self.assertEqual(renamed[0].completion_criterion, CRITERION)

    def test_non_kaoyan_goal_is_saved_and_old_row_stays_unset(self) -> None:
        self._verify()
        created = self.client.post("/api/plans/generate", json=_complete())
        self.assertEqual([name for name, _ in _parse_sse(created.text)], ["done"])
        self.assertEqual(GoalRouteTests.calls, 1)
        plan = self._plans()[0]
        self.assertEqual(plan.goal_name, GOAL)
        self.assertEqual(plan.completion_criterion, CRITERION)
        self.assertNotEqual(plan.current_level, CRITERION)

        plan.completion_criterion = None
        self.session.commit()
        latest = self.client.get("/api/plans/latest")
        body = latest.json()["plan"]
        self.assertIsNone(body["completionCriterion"])
        self.assertNotIn("掌握度", json.dumps(body, ensure_ascii=False))

    def test_draft_reply_does_not_change_an_existing_plan(self) -> None:
        self._verify()
        created = self.client.post("/api/plans/generate", json=_complete())
        self.assertEqual([name for name, _ in _parse_sse(created.text)], ["done"])
        plan = self._plans()[0]
        opened = self.client.post(
            "/api/plans/generate",
            json=_complete(goalName="概率论", documentIds=[]),
        )
        draft_id = _parse_sse(opened.text)[0][1]["draftId"]
        self.client.post(f"/api/plans/{draft_id}/clarify", json={"message": "改学拓扑"})
        self.session.expire_all()
        fresh = self.session.get(Plan, plan.id)
        self.assertEqual(fresh.goal_name, GOAL)
        self.assertEqual(fresh.completion_criterion, CRITERION)

    def test_criterion_change_waits_for_confirm_and_undo_restores_it(self) -> None:
        self._verify()
        created = self.client.post("/api/plans/generate", json=_complete(dailyMinutes=120))
        self.assertEqual([name for name, _ in _parse_sse(created.text)], ["done"])
        plan = self._plans()[0]
        preview = self.client.post(
            f"/api/plans/{plan.id}/regenerate",
            json={"message": "只改完成标准", "completionCriterion": "能向别人讲清秩的定义"},
        )
        events = _parse_sse(preview.text)
        self.assertEqual([name for name, _ in events], ["preview"])
        self.session.expire_all()
        self.assertEqual(self.session.get(Plan, plan.id).completion_criterion, CRITERION)
        body = events[0][1]
        confirmed = self.client.post(
            f"/api/plans/{plan.id}/adjustments/{body['id']}/confirm",
            json={"selectionVersion": body["selectionVersion"]},
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.text)
        self.session.expire_all()
        self.assertEqual(
            self.session.get(Plan, plan.id).completion_criterion,
            "能向别人讲清秩的定义",
        )
        undone = self.client.post(f"/api/plans/{plan.id}/adjustments/undo")
        self.assertEqual(undone.status_code, 200, undone.text)
        self.session.expire_all()
        self.assertEqual(self.session.get(Plan, plan.id).completion_criterion, CRITERION)

    def test_old_plan_without_criterion_can_still_confirm_another_change(self) -> None:
        self._verify()
        created = self.client.post("/api/plans/generate", json=_complete(dailyMinutes=120))
        done = _parse_sse(created.text)
        self.assertEqual([name for name, _ in done], ["done"])
        plan = self._plans()[0]
        plan.completion_criterion = None
        self.session.commit()
        preview = self.client.post(
            f"/api/plans/{plan.id}/regenerate",
            json={"message": "把每天时间改成 2 小时", "dailyMinutes": 120},
        )
        body = _parse_sse(preview.text)[0][1]
        confirmed = self.client.post(
            f"/api/plans/{plan.id}/adjustments/{body['id']}/confirm",
            json={"selectionVersion": body["selectionVersion"]},
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.text)
        self.session.expire_all()
        fresh = self.session.get(Plan, plan.id)
        self.assertIsNone(fresh.completion_criterion)
        self.assertEqual(fresh.goal_name, GOAL)

    def test_rejected_dates_and_minutes_do_not_persist(self) -> None:
        self._verify()
        for payload in (
            _complete(goalDate="20270630"),
            _complete(goalDate="2020-01-01"),
            _complete(dailyMinutes=12.5),
            _complete(dailyMinutes=True),
        ):
            GoalRouteTests.calls = 0
            response = self.client.post("/api/plans/generate", json=payload)
            self.assertEqual(self._plans(), [], payload)
            self.assertEqual(GoalRouteTests.calls, 0)
            if response.status_code == 200:
                self.assertNotIn("done", [name for name, _ in _parse_sse(response.text)])

    def test_m1_document_chat_collects_criterion_reply(self) -> None:
        self._verify()
        self._doc()
        opened = self.client.post(
            "/api/plans/generate",
            json=_complete(completionCriterion=None, documentIds=["doc-la"]),
        )
        draft_id = _parse_sse(opened.text)[0][1]["draftId"]
        reply = self.client.post(
            f"/api/plans/{draft_id}/clarify",
            json={"message": CRITERION},
        )
        self.assertEqual([name for name, _ in _parse_sse(reply.text)], ["done"])
        self.assertEqual(self._plans()[0].completion_criterion, CRITERION)
        self.assertEqual(self._plans()[0].goal_name, GOAL)

    def test_m2_labeled_reply_and_invalid_date_do_not_replace_goal(self) -> None:
        self._verify()
        opened = self.client.post(
            "/api/plans/generate",
            json=_complete(goalName="学习", completionCriterion=None, documentIds=[]),
        )
        draft_id = _parse_sse(opened.text)[0][1]["draftId"]
        labeled = self.client.post(
            f"/api/plans/{draft_id}/clarify",
            json={"message": "完成标准：" + CRITERION},
        )
        draft = plan_draft_store.get(draft_id, self.user.id)
        self.assertEqual(draft.fields["goalName"], "学习")
        self.assertEqual(draft.fields["completionCriterion"], CRITERION)
        self.assertNotIn("preview", [name for name, _ in _parse_sse(labeled.text)])

        dated = self.client.post(
            "/api/plans/generate",
            json=_complete(goalName="学习", documentIds=[]),
        )
        date_id = _parse_sse(dated.text)[0][1]["draftId"]
        bad_date = self.client.post(
            f"/api/plans/{date_id}/clarify",
            json={"message": "2027-02-30"},
        )
        date_draft = plan_draft_store.get(date_id, self.user.id)
        self.assertEqual(date_draft.fields["goalName"], "学习")
        self.assertNotEqual(date_draft.fields.get("goalDate"), "2027-02-30")
        self.assertNotIn("preview", [name for name, _ in _parse_sse(bad_date.text)])

        minutes = self.client.post(
            f"/api/plans/{date_id}/clarify",
            json={"message": "12.5分钟"},
        )
        minute_draft = plan_draft_store.get(date_id, self.user.id)
        self.assertEqual(minute_draft.fields["goalName"], "学习")
        self.assertNotEqual(minute_draft.fields.get("dailyMinutes"), 12)
        self.assertNotIn("done", [name for name, _ in _parse_sse(minutes.text)])

    def test_m2_two_missing_fields_are_not_swapped(self) -> None:
        self._verify()
        opened = self.client.post(
            "/api/plans/generate",
            json=_complete(
                currentLevel=None,
                completionCriterion=None,
                documentIds=[],
            ),
        )
        draft_id = _parse_sse(opened.text)[0][1]["draftId"]
        self.client.post(
            f"/api/plans/{draft_id}/clarify",
            json={"message": CRITERION},
        )
        draft = plan_draft_store.get(draft_id, self.user.id)
        self.assertEqual(draft.fields["goalName"], GOAL)
        self.assertIsNone(draft.fields.get("completionCriterion"))
        self.assertIsNone(draft.fields.get("currentLevel"))

    def test_m3_changed_goal_fields_do_not_confirm_old_preview(self) -> None:
        self._verify()

        def factory():
            def generator(fields, used_docs, context_text, instruction):
                structure = _structure()
                for phase in structure["phases"]:
                    for task in phase["daily_tasks"]:
                        task["description"] = str(fields.get("completionCriterion"))
                return structure

            return generator

        app.dependency_overrides[get_plan_generator] = factory
        opened = self.client.post("/api/plans/generate", json=_complete(documentIds=[]))
        draft_id = _parse_sse(opened.text)[0][1]["draftId"]
        changed = "能构造矩阵反例"
        reply = self.client.post(
            f"/api/plans/{draft_id}/clarify",
            json={"message": "确定", "completionCriterion": changed},
        )
        events = [name for name, _ in _parse_sse(reply.text)]
        self.assertNotIn("done", events)
        self.assertEqual(self._plans(), [])
        self.assertEqual(events, ["preview"])
        saved = self.client.post(
            f"/api/plans/{draft_id}/clarify",
            json={"message": "确定"},
        )
        self.assertEqual([name for name, _ in _parse_sse(saved.text)], ["done"])
        plan = self._plans()[0]
        self.assertEqual(plan.completion_criterion, changed)
        descriptions = list(self.session.scalars(select(DailyTask.description)))
        self.assertTrue(descriptions)
        self.assertTrue(all(item == changed for item in descriptions))

    def test_m3_failed_regeneration_drops_old_preview(self) -> None:
        self._verify()
        calls = {"n": 0}

        def factory():
            def generator(fields, used_docs, context_text, instruction):
                calls["n"] += 1
                if calls["n"] > 1:
                    raise planner_service.PlanGenerationError("生成失败")
                return _structure()

            return generator

        app.dependency_overrides[get_plan_generator] = factory
        opened = self.client.post("/api/plans/generate", json=_complete(documentIds=[]))
        draft_id = _parse_sse(opened.text)[0][1]["draftId"]
        failed = self.client.post(
            f"/api/plans/{draft_id}/clarify",
            json={"message": "确定", "completionCriterion": "能构造矩阵反例"},
        )
        self.assertIn("error", [name for name, _ in _parse_sse(failed.text)])
        self.assertEqual(self._plans(), [])
        again = self.client.post(
            f"/api/plans/{draft_id}/clarify",
            json={"message": "确定"},
        )
        self.assertNotIn("done", [name for name, _ in _parse_sse(again.text)])
        self.assertEqual(self._plans(), [])

    def test_m4_explicit_criterion_phrase_previews_and_vague_phrase_is_refused(self) -> None:
        self._verify()
        created = self.client.post("/api/plans/generate", json=_complete(dailyMinutes=120))
        self.assertEqual(_parse_sse(created.text)[0][0], "done")
        plan = self._plans()[0]
        changed = "能构造矩阵反例"
        vague = self.client.post(
            f"/api/plans/{plan.id}/regenerate",
            json={"message": "改一下完成标准"},
        )
        vague_events = _parse_sse(vague.text)
        self.assertEqual([name for name, _ in vague_events], ["error"])
        self.assertIn("完成标准", vague_events[0][1]["message"])
        self.session.expire_all()
        self.assertEqual(self.session.get(Plan, plan.id).completion_criterion, CRITERION)

        preview = self.client.post(
            f"/api/plans/{plan.id}/regenerate",
            json={"message": "把规划的完成标准改为：" + changed},
        )
        body = _parse_sse(preview.text)[0][1]
        self.assertIn(
            {"field": "completionCriterion", "before": CRITERION, "after": changed},
            body["diff"]["planChanges"],
        )
        self.session.expire_all()
        self.assertEqual(self.session.get(Plan, plan.id).completion_criterion, CRITERION)
        confirmed = self.client.post(
            f"/api/plans/{plan.id}/adjustments/{body['id']}/confirm",
            json={"selectionVersion": body["selectionVersion"]},
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.text)
        self.session.expire_all()
        self.assertEqual(self.session.get(Plan, plan.id).completion_criterion, changed)
        undone = self.client.post(f"/api/plans/{plan.id}/adjustments/undo")
        self.assertEqual(undone.status_code, 200, undone.text)
        self.session.expire_all()
        self.assertEqual(self.session.get(Plan, plan.id).completion_criterion, CRITERION)

    def test_n1_empty_criterion_label_does_not_generate(self) -> None:
        self._verify()
        self._doc()
        opened = self.client.post(
            "/api/plans/generate",
            json=_complete(completionCriterion=None, documentIds=["doc-la"]),
        )
        draft_id = _parse_sse(opened.text)[0][1]["draftId"]
        reply = self.client.post(
            f"/api/plans/{draft_id}/clarify",
            json={"message": "完成标准："},
        )
        events = _parse_sse(reply.text)
        self.assertEqual([name for name, _ in events], ["clarify"])
        self.assertIn("没有写内容", events[0][1]["question"])
        self.assertEqual(self._plans(), [])
        draft = plan_draft_store.get(draft_id, self.user.id)
        self.assertIsNone(draft.fields.get("completionCriterion"))
        self.assertEqual(draft.fields["goalName"], GOAL)

        no_file = self.client.post(
            "/api/plans/generate",
            json=_complete(completionCriterion=None, documentIds=[]),
        )
        no_file_id = _parse_sse(no_file.text)[0][1]["draftId"]
        bare = self.client.post(
            f"/api/plans/{no_file_id}/clarify",
            json={"message": "完成标准："},
        )
        bare_events = _parse_sse(bare.text)
        self.assertEqual([name for name, _ in bare_events], ["clarify"])
        self.assertIn("没有写内容", bare_events[0][1]["question"])
        stored = plan_draft_store.get(no_file_id, self.user.id)
        self.assertIsNone(stored.fields.get("completionCriterion"))
        self.assertEqual(self._plans(), [])

    def test_n1_invalid_shapes_stay_on_their_field(self) -> None:
        self._verify()
        cases = (
            ("-30分钟", "正整数"),
            ("2027-2-30", "YYYY-MM-DD"),
            ("当前基础：", "没有写内容"),
        )
        for text, explanation in cases:
            opened = self.client.post(
                "/api/plans/generate",
                json=_complete(goalName="学习", documentIds=[]),
            )
            draft_id = _parse_sse(opened.text)[0][1]["draftId"]
            reply = self.client.post(
                f"/api/plans/{draft_id}/clarify",
                json={"message": text},
            )
            draft = plan_draft_store.get(draft_id, self.user.id)
            events = _parse_sse(reply.text)
            self.assertEqual(draft.fields["goalName"], "学习", text)
            self.assertEqual(draft.fields["goalDate"], FUTURE, text)
            self.assertEqual(draft.fields["dailyMinutes"], 45, text)
            self.assertEqual(draft.fields["completionCriterion"], CRITERION, text)
            self.assertEqual(draft.fields["currentLevel"], "学过矩阵", text)
            self.assertEqual([name for name, _ in events], ["clarify"], text)
            self.assertIn(explanation, events[0][1]["question"], text)
            self.assertEqual(self._plans(), [])

        dated = self.client.post(
            "/api/plans/generate",
            json=_complete(goalName="学习", documentIds=[]),
        )
        date_id = _parse_sse(dated.text)[0][1]["draftId"]
        accepted = self.client.post(
            f"/api/plans/{date_id}/clarify",
            json={"message": "期限：2027-02-30"},
        )
        date_draft = plan_draft_store.get(date_id, self.user.id)
        date_events = _parse_sse(accepted.text)
        self.assertEqual(date_draft.fields["goalName"], "学习")
        self.assertEqual(date_draft.fields["goalDate"], FUTURE)
        self.assertEqual(date_draft.fields["dailyMinutes"], 45)
        self.assertEqual([name for name, _ in date_events], ["clarify"])
        self.assertIn("YYYY-MM-DD", date_events[0][1]["question"])
        self.assertEqual(self._plans(), [])

    def test_n1_invalid_reply_does_not_regenerate_complete_draft(self) -> None:
        self._verify()
        opened = self.client.post("/api/plans/generate", json=_complete(documentIds=[]))
        draft_id = _parse_sse(opened.text)[0][1]["draftId"]
        calls = GoalRouteTests.calls
        reply = self.client.post(
            f"/api/plans/{draft_id}/clarify",
            json={"message": "-30分钟"},
        )
        events = _parse_sse(reply.text)
        draft = plan_draft_store.get(draft_id, self.user.id)
        self.assertEqual([name for name, _ in events], ["clarify"])
        self.assertIn("正整数", events[0][1]["question"])
        self.assertEqual(draft.fields["dailyMinutes"], 45)
        self.assertEqual(draft.fields["goalName"], GOAL)
        self.assertEqual(GoalRouteTests.calls, calls)
        self.assertEqual(self._plans(), [])


class GoalAdjustmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._environment = {
            name: os.environ.get(name)
            for name in ("DATABASE_URL", "DB_PASSWORD", "AES_KEY")
        }
        os.environ["DATABASE_URL"] = "sqlite:///:memory:"
        os.environ["DB_PASSWORD"] = "temporary-test-password"
        os.environ["AES_KEY"] = base64.b64encode(bytes(range(32))).decode("ascii")
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
        self.user = User(username=f"b5-adj-{os.urandom(4).hex()}", password_hash="x" * 20)
        self.session.add(self.user)
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _plan(self, criterion: str | None) -> Plan:
        today = local_today()
        plan = Plan(
            user_id=self.user.id,
            goal_name=GOAL,
            start_date=today - timedelta(days=3),
            goal_date=today + timedelta(days=40),
            current_level="学过矩阵",
            daily_minutes=45,
            total_phases=2,
            completion_criterion=criterion,
        )
        self.session.add(plan)
        self.session.flush()
        for index in (1, 2):
            phase = Phase(
                plan_id=plan.id,
                phase_index=index,
                name=f"阶段 {index}",
                start_date=today,
                end_date=today,
            )
            self.session.add(phase)
            self.session.flush()
            self.session.add(
                DailyTask(
                    plan_id=plan.id,
                    phase_id=phase.id,
                    task_date=today,
                    week_label="W01",
                    description=f"阶段{index}任务",
                    status="pending",
                    estimated_minutes=20,
                )
            )
        self.session.commit()
        return plan

    def test_old_snapshot_without_criterion_key_does_not_clear_later_text(self) -> None:
        plan = self._plan("后来填写的标准")
        before = adjustment_service._snapshot_body(self.session, plan)
        before["plan"].pop("completionCriterion", None)
        after = dict(before["plan"])
        after.pop("completionCriterion", None)
        after["goalName"] = "概率论"
        plan.goal_name = "概率论"
        self.session.add(
            PlanAdjustment(
                user_id=self.user.id,
                plan_id=plan.id,
                status="confirmed",
                instruction="改对象",
                basis_fingerprint="legacy",
                proposal={"fields": {"goalName": "概率论"}},
                diff={},
                validation={"ok": True},
                steps=[],
                decision_summary="已确认",
                evidence_refs=[],
                applied_record={
                    "before": before,
                    "after_created": {},
                    "after_phases": {},
                    "removed_ids": [],
                    "created_ids": [],
                    "created_phase_ids": [],
                    "plan_before": before["plan"],
                    "plan_after": after,
                    "plan_field_changes": {
                        "goal_name": {"before": GOAL, "after": "概率论"}
                    },
                },
            )
        )
        self.session.commit()
        adjustment_service.undo_latest(self.session, self.user.id, plan.id)
        self.session.expire_all()
        restored = self.session.get(Plan, plan.id)
        self.assertEqual(restored.goal_name, GOAL)
        self.assertEqual(restored.completion_criterion, "后来填写的标准")


class CompletionCriterionMigrationTests(unittest.TestCase):
    def test_upgrade_downgrade_upgrade_on_temporary_sqlite(self) -> None:
        from alembic import command
        from alembic.config import Config

        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / "batch5.db"
            previous = {
                name: os.environ.get(name)
                for name in ("DATABASE_URL", "DB_PASSWORD", "AES_KEY")
            }
            os.environ["DATABASE_URL"] = f"sqlite:///{database.as_posix()}"
            os.environ["DB_PASSWORD"] = "temporary-test-password"
            os.environ["AES_KEY"] = base64.b64encode(bytes(range(32))).decode("ascii")
            get_settings.cache_clear()
            backend = Path(__file__).resolve().parents[1]
            config = Config(str(backend / "alembic.ini"))
            config.set_main_option("script_location", str(backend / "alembic"))
            config.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])
            try:
                command.upgrade(config, "head")
                self._assert_column(database, True)
                command.downgrade(config, "-1")
                self._assert_column(database, False)
                command.upgrade(config, "head")
                self._assert_column(database, True)
            finally:
                get_settings.cache_clear()
                for name, value in previous.items():
                    if value is None:
                        os.environ.pop(name, None)
                    else:
                        os.environ[name] = value

    def _assert_column(self, database: Path, present: bool) -> None:
        engine = create_engine(f"sqlite:///{database.as_posix()}")
        columns = {column["name"] for column in inspect(engine).get_columns("plans")}
        engine.dispose()
        self.assertEqual("completion_criterion" in columns, present)
