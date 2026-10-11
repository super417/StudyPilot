"""Batch-2 review fixes R1–R7 and round-2 C1–C5 (mock HTTP / injected generators)."""

from __future__ import annotations

import os
import tempfile
import threading
import unittest
import uuid
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import httpx
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.clock import local_today
from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import (
    ApiConfig,
    DailyTask,
    Phase,
    Plan,
    PlanAdjustment,
    PracticeQuestion,
    User,
)
from app.services import adjustment_service, planner_service, task_service
from app.services.planner_service import PlanGenerationError


def _today_structure(phase_count: int = 2, empty_tasks: bool = False) -> dict:
    today = local_today()
    return {
        "phases": [
            {
                "name": f"阶段{i + 1}",
                "start_date": today.isoformat(),
                "end_date": (today + timedelta(days=2)).isoformat(),
                "daily_tasks": []
                if empty_tasks
                else [
                    {
                        "task_date": (today + timedelta(days=d)).isoformat(),
                        "week_label": "W01",
                        "description": f"明确任务P{i + 1}D{d}",
                        "estimated_minutes": 20,
                    }
                    for d in range(1)
                ],
            }
            for i in range(phase_count)
        ]
    }


class AdjustmentFixTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._environment = {
            name: os.environ.get(name) for name in ("DATABASE_URL", "DB_PASSWORD")
        }
        os.environ["DATABASE_URL"] = "sqlite:///:memory:"
        os.environ["DB_PASSWORD"] = "temporary-test-password"
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
        self.today = local_today()
        self.user = User(username=f"fx-{os.urandom(4).hex()}", password_hash="x" * 20)
        self.session.add(self.user)
        self.session.commit()
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
        self.plan = Plan(
            user_id=self.user.id,
            goal_name="考研数学",
            start_date=self.today,
            goal_date=self.today + timedelta(days=90),
            current_level="零基础",
            daily_minutes=90,
            total_phases=2,
        )
        self.session.add(self.plan)
        self.session.flush()
        self.phase = Phase(
            plan_id=self.plan.id,
            phase_index=1,
            name="基础",
            start_date=self.today,
            end_date=self.today + timedelta(days=10),
            is_current=True,
        )
        self.session.add(self.phase)
        self.session.flush()
        self.pending = DailyTask(
            plan_id=self.plan.id,
            phase_id=self.phase.id,
            task_date=self.today + timedelta(days=2),
            week_label="W01",
            description="将来可替换",
            status="pending",
            estimated_minutes=20,
        )
        self.session.add(self.pending)
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _gen(self, empty: bool = False):
        def generator(fields, used_docs, context_text, instruction):
            return _today_structure(2, empty_tasks=empty)

        return generator

    async def test_r1_default_generator_parse_failure_is_error(self) -> None:
        """Mock HTTP 200 with non-JSON plan text; no injected generator."""
        handler_calls = {"n": 0}
        real_async_client = httpx.AsyncClient

        def handler(request: httpx.Request) -> httpx.Response:
            handler_calls["n"] += 1
            return httpx.Response(
                200,
                json={"choices": [{"message": {"content": "not a plan JSON"}}]},
            )

        transport = httpx.MockTransport(handler)

        def client_factory(*args, **kwargs):
            kwargs = dict(kwargs)
            kwargs["transport"] = transport
            return real_async_client(*args, **kwargs)

        with patch(
            "app.services.planner_service.httpx.AsyncClient", side_effect=client_factory
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
        ), patch(
            "app.services.planner_service._parse_plan_structure_from_text",
            wraps=planner_service._parse_plan_structure_from_text,
        ) as parse_spy:
            with self.assertRaises(PlanGenerationError) as ctx:
                await adjustment_service.create_preview(
                    self.session,
                    self.user.id,
                    self.plan.id,
                    "重排",
                    None,
                    [],
                    None,
                )
            self.assertGreaterEqual(handler_calls["n"], 1)
            self.assertGreaterEqual(parse_spy.call_count, 1)
            self.assertIn("not a plan JSON", str(parse_spy.call_args.args[0]))
            # Error comes from invalid model text / parse, not transport recursion.
            self.assertIsInstance(ctx.exception, PlanGenerationError)
        self.assertIsNone(self.session.scalar(select(PlanAdjustment).limit(1)))
        self.assertEqual(
            self.session.get(DailyTask, self.pending.id).description, "将来可替换"
        )
        self.assertEqual(self.session.get(Plan, self.plan.id).goal_name, "考研数学")

    async def test_r2_empty_tasks_fail_preview_not_filled_on_confirm(self) -> None:
        with self.assertRaises(PlanGenerationError):
            await adjustment_service.create_preview(
                self.session,
                self.user.id,
                self.plan.id,
                "空任务",
                None,
                [],
                self._gen(empty=True),
            )
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "有任务",
            None,
            [],
            self._gen(empty=False),
        )
        self.assertEqual(len(preview.diff["proposedPending"]), 2)
        confirmed = adjustment_service.confirm_adjustment(
            self.session, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
        )
        created = list(
            self.session.scalars(
                select(DailyTask).where(
                    DailyTask.plan_id == self.plan.id,
                    DailyTask.description.like("明确任务%"),
                )
            )
        )
        self.assertEqual(len(created), 2)
        self.assertEqual(len(confirmed.applied_record["created_ids"]), 2)

    async def test_r3_undo_conflicts_when_plan_minutes_changed_later(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "改",
            {"dailyMinutes": 120},
            [],
            self._gen(),
        )
        adjustment_service.confirm_adjustment(
            self.session, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
        )
        self.session.expire_all()
        plan = self.session.get(Plan, self.plan.id)
        plan.daily_minutes = 123
        self.session.commit()
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.undo_latest(self.session, self.user.id, self.plan.id)
        self.assertEqual(self.session.get(Plan, self.plan.id).daily_minutes, 123)

    async def test_r4_answered_by_status_not_answer_text(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "改",
            None,
            [],
            self._gen(),
        )
        confirmed = adjustment_service.confirm_adjustment(
            self.session, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
        )
        created_id = uuid.UUID(confirmed.applied_record["created_ids"][0])
        # Reference key present but still pending → not answered.
        self.session.add(
            PracticeQuestion(
                user_id=self.user.id,
                source="generated",
                question="题",
                answer="参考答案",
                explanation="",
                status="pending",
                source_task_id=created_id,
            )
        )
        self.session.commit()
        undone = adjustment_service.undo_latest(
            self.session, self.user.id, self.plan.id
        )
        self.assertEqual(undone.status, "undone")

        preview2 = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "再改",
            None,
            [],
            self._gen(),
        )
        confirmed2 = adjustment_service.confirm_adjustment(
            self.session, self.user.id, self.plan.id, preview2.id, expected_selection_version=preview2.proposal["selectionVersion"]
        )
        created2 = uuid.UUID(confirmed2.applied_record["created_ids"][0])
        self.session.add(
            PracticeQuestion(
                user_id=self.user.id,
                source="uploaded",
                question="题2",
                answer="",
                explanation="",
                status="correct",
                source_task_id=created2,
            )
        )
        self.session.commit()
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.undo_latest(self.session, self.user.id, self.plan.id)

    async def test_r5_undo_all_future_pending_no_unique_conflict(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "全未来",
            None,
            [],
            self._gen(),
        )
        confirmed = adjustment_service.confirm_adjustment(
            self.session, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
        )
        pending_id = self.pending.id
        undone = adjustment_service.undo_latest(
            self.session, self.user.id, self.plan.id
        )
        self.assertEqual(undone.id, confirmed.id)
        self.assertEqual(undone.status, "undone")
        restored = self.session.get(DailyTask, pending_id)
        self.assertIsNotNone(restored)
        self.assertEqual(restored.description, "将来可替换")
        phases = list(
            self.session.scalars(select(Phase).where(Phase.plan_id == self.plan.id))
        )
        indexes = sorted(phase.phase_index for phase in phases)
        self.assertEqual(indexes, list(dict.fromkeys(indexes)))

    async def test_r6_failed_validation_blocks_confirm(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "改",
            None,
            [],
            self._gen(),
        )
        preview.validation = {**preview.validation, "ok": False}
        self.session.commit()
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.confirm_adjustment(
                self.session, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
            )
        self.assertEqual(
            self.session.get(DailyTask, self.pending.id).description, "将来可替换"
        )
        self.assertIn("duration", preview.validation.get("checks", {}))
        self.assertNotIn("unverified", preview.validation.get("checks", {}).values())

    async def test_r7_interleaved_reject_and_task_edit_with_second_session(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "改",
            None,
            [],
            self._gen(),
        )
        other = self.session_factory()
        try:
            adjustment_service.reject_adjustment(
                other, self.user.id, self.plan.id, preview.id
            )
        finally:
            other.close()
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.confirm_adjustment(
                self.session, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
            )

        preview2 = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "再改",
            None,
            [],
            self._gen(),
        )
        editor = self.session_factory()
        try:
            task = editor.get(DailyTask, self.pending.id)
            task.description = "并发改动"
            editor.commit()
        finally:
            editor.close()
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.confirm_adjustment(
                self.session, self.user.id, self.plan.id, preview2.id, expected_selection_version=preview2.proposal["selectionVersion"]
            )

    async def test_c1_cross_day_confirm_rejects_without_partial_write(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "跨日确认",
            None,
            [],
            self._gen(),
        )
        self.assertEqual(len(preview.diff["proposedPending"]), 2)
        pending_desc = self.session.get(DailyTask, self.pending.id).description
        phase_count = self.session.scalar(
            select(Phase).where(Phase.plan_id == self.plan.id).limit(1)
        )
        self.assertIsNotNone(phase_count)
        tomorrow = self.today + timedelta(days=1)
        with patch("app.services.adjustment_service.local_today", return_value=tomorrow):
            with self.assertRaises(adjustment_service.AdjustmentConflictError):
                adjustment_service.confirm_adjustment(
                    self.session, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
                )
        self.session.expire_all()
        row = self.session.get(PlanAdjustment, preview.id)
        self.assertEqual(row.status, "conflict")
        self.assertIsNone(row.applied_record)
        self.assertEqual(
            self.session.get(DailyTask, self.pending.id).description, pending_desc
        )
        self.assertFalse(
            any(
                "明确任务" in (task.description or "")
                for task in self.session.scalars(
                    select(DailyTask).where(DailyTask.plan_id == self.plan.id)
                )
            )
        )
        self.assertEqual(
            self.session.scalar(
                select(Phase).where(Phase.plan_id == self.plan.id, Phase.id == self.phase.id)
            ).name,
            "基础",
        )

    async def test_c2_undo_conflicts_when_created_phase_renamed(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "阶段改名",
            None,
            [],
            self._gen(),
        )
        confirmed = adjustment_service.confirm_adjustment(
            self.session, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
        )
        created_phase_id = uuid.UUID(confirmed.applied_record["created_phase_ids"][0])
        phase = self.session.get(Phase, created_phase_id)
        phase.name = "later user edit"
        self.session.commit()
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.undo_latest(self.session, self.user.id, self.plan.id)
        self.session.expire_all()
        self.assertEqual(self.session.get(Phase, created_phase_id).name, "later user edit")
        self.assertEqual(
            self.session.get(PlanAdjustment, confirmed.id).status, "confirmed"
        )

    async def test_c3_confirm_keeps_answered_practice_link(self) -> None:
        self.session.execute(text("PRAGMA foreign_keys=ON"))
        self.session.commit()
        practice = PracticeQuestion(
            user_id=self.user.id,
            source="generated",
            question="已作答",
            answer="",
            explanation="",
            status="correct",
            source_task_id=self.pending.id,
        )
        self.session.add(practice)
        self.session.commit()
        practice_id = practice.id
        old_task_id = self.pending.id
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "保留作答关联",
            None,
            [],
            self._gen(),
        )
        removable_ids = {item["id"] for item in preview.diff["removedOrReplaced"]}
        self.assertNotIn(str(old_task_id), removable_ids)
        confirmed = adjustment_service.confirm_adjustment(
            self.session, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
        )
        self.assertEqual(confirmed.status, "confirmed")
        self.session.expire_all()
        kept = self.session.get(DailyTask, old_task_id)
        self.assertIsNotNone(kept)
        linked = self.session.get(PracticeQuestion, practice_id)
        self.assertIsNotNone(linked)
        self.assertEqual(linked.source_task_id, old_task_id)

    async def test_cross_day_undo_conflicts_without_mutating(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "跨日撤销",
            None,
            [],
            self._gen(),
        )
        confirmed = adjustment_service.confirm_adjustment(
            self.session, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
        )
        created_ids = list(confirmed.applied_record["created_ids"])
        created_phase_ids = list(confirmed.applied_record["created_phase_ids"])
        tomorrow = self.today + timedelta(days=1)
        with patch("app.services.adjustment_service.local_today", return_value=tomorrow):
            with self.assertRaises(adjustment_service.AdjustmentConflictError):
                adjustment_service.undo_latest(
                    self.session, self.user.id, self.plan.id
                )
        self.session.expire_all()
        self.assertEqual(
            self.session.get(PlanAdjustment, confirmed.id).status, "confirmed"
        )
        for task_id in created_ids:
            self.assertIsNotNone(self.session.get(DailyTask, uuid.UUID(task_id)))
        for phase_id in created_phase_ids:
            self.assertIsNotNone(self.session.get(Phase, uuid.UUID(phase_id)))
        self.assertEqual(self.session.get(Plan, self.plan.id).daily_minutes, 90)


class AdjustmentConcurrentFixTests(unittest.IsolatedAsyncioTestCase):
    """C4: file SQLite + independent connections (not StaticPool shared txn)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls._environment = {
            name: os.environ.get(name) for name in ("DATABASE_URL", "DB_PASSWORD")
        }
        cls._db_path = Path(tempfile.mkstemp(suffix="-adj-c4.db")[1])
        os.environ["DATABASE_URL"] = f"sqlite:///{cls._db_path.as_posix()}"
        os.environ["DB_PASSWORD"] = "temporary-test-password"
        get_settings.cache_clear()
        get_cipher.cache_clear()
        cls.engine = create_engine(
            f"sqlite:///{cls._db_path.as_posix()}",
            connect_args={"check_same_thread": False},
        )

        @event.listens_for(cls.engine, "connect")
        def _fk(dbapi_connection, _connection_record) -> None:  # noqa: ANN001
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

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
        try:
            cls._db_path.unlink(missing_ok=True)
        except OSError:
            pass

    def setUp(self) -> None:
        Base.metadata.drop_all(self.engine)
        Base.metadata.create_all(self.engine)
        self.session = self.session_factory()
        self.today = local_today()
        self.user = User(username=f"c4-{os.urandom(4).hex()}", password_hash="x" * 20)
        self.session.add(self.user)
        self.session.commit()
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
        self.plan = Plan(
            user_id=self.user.id,
            goal_name="并发计划",
            start_date=self.today,
            goal_date=self.today + timedelta(days=90),
            current_level="零基础",
            daily_minutes=90,
            total_phases=2,
        )
        self.session.add(self.plan)
        self.session.flush()
        self.phase = Phase(
            plan_id=self.plan.id,
            phase_index=1,
            name="基础",
            start_date=self.today,
            end_date=self.today + timedelta(days=10),
            is_current=True,
        )
        self.session.add(self.phase)
        self.session.flush()
        self.pending = DailyTask(
            plan_id=self.plan.id,
            phase_id=self.phase.id,
            task_date=self.today + timedelta(days=2),
            week_label="W01",
            description="将来可替换",
            status="pending",
            estimated_minutes=20,
        )
        self.session.add(self.pending)
        self.session.commit()
        adjustment_service._confirm_after_fingerprint_hook = None
        adjustment_service._confirm_between_claim_and_apply = None

    def tearDown(self) -> None:
        adjustment_service._confirm_after_fingerprint_hook = None
        adjustment_service._confirm_between_claim_and_apply = None
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _gen(self):
        def generator(fields, used_docs, context_text, instruction):
            return _today_structure(2, empty_tasks=False)

        return generator

    async def test_c4_fingerprint_to_write_interleave_via_independent_session(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "交错",
            None,
            [],
            self._gen(),
        )
        task_id = self.pending.id

        def mutate_after_fingerprint(_session, _row) -> None:
            other = self.session_factory()
            try:
                task_service.set_task_status(other, self.user.id, task_id, "done")
            finally:
                other.close()

        adjustment_service._confirm_after_fingerprint_hook = mutate_after_fingerprint
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.confirm_adjustment(
                self.session, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
            )
        self.session.expire_all()
        row = self.session.get(PlanAdjustment, preview.id)
        self.assertEqual(row.status, "conflict")
        self.assertIsNone(row.applied_record)
        self.assertEqual(self.session.get(DailyTask, task_id).status, "done")
        self.assertFalse(
            any(
                "明确任务" in (task.description or "")
                for task in self.session.scalars(
                    select(DailyTask).where(DailyTask.plan_id == self.plan.id)
                )
            )
        )

    async def test_c4_dual_confirm_only_one_applies(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "双确认",
            None,
            [],
            self._gen(),
        )
        barrier = threading.Barrier(2)
        outcomes: list[object] = []
        lock = threading.Lock()

        def worker() -> None:
            sess = self.session_factory()
            try:
                barrier.wait(timeout=5)
                try:
                    row = adjustment_service.confirm_adjustment(
                        sess, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
                    )
                    with lock:
                        outcomes.append(("ok", row.status, len(row.applied_record.get("created_ids") or [])))
                except adjustment_service.AdjustmentConflictError as exc:
                    with lock:
                        outcomes.append(("conflict_error", type(exc).__name__, str(exc)))
                except Exception as exc:  # noqa: BLE001 — fail closed on unexpected errors
                    with lock:
                        outcomes.append(("unexpected", type(exc).__name__, str(exc)))
            finally:
                sess.close()

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        self.assertEqual(len(outcomes), 2, outcomes)
        unexpected = [item for item in outcomes if item[0] == "unexpected"]
        self.assertEqual(unexpected, [], outcomes)
        oks = [item for item in outcomes if item[0] == "ok"]
        self.assertGreaterEqual(len(oks), 1, outcomes)
        self.assertTrue(all(item[1] == "confirmed" for item in oks), outcomes)
        self.session.expire_all()
        row = self.session.get(PlanAdjustment, preview.id)
        self.assertEqual(row.status, "confirmed")
        self.assertNotEqual(row.status, "conflict")
        applied = [
            step
            for step in (row.steps or [])
            if isinstance(step, dict) and step.get("result") == "applied"
        ]
        conflicts = [
            step
            for step in (row.steps or [])
            if isinstance(step, dict) and step.get("result") == "conflict"
        ]
        self.assertEqual(len(applied), 1, row.steps)
        self.assertEqual(conflicts, [], row.steps)
        created = list(
            self.session.scalars(
                select(DailyTask).where(
                    DailyTask.plan_id == self.plan.id,
                    DailyTask.description.like("明确任务%"),
                )
            )
        )
        self.assertEqual(len(created), 2)
        self.assertEqual(len(row.applied_record.get("created_ids") or []), 2)

    async def test_d1_stale_confirm_does_not_overwrite_confirmed(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "陈旧确认",
            None,
            [],
            self._gen(),
        )
        real_fp = adjustment_service.basis_fingerprint
        state = {"done": False, "winner_ids": None}

        def wrapped(session, plan):
            fingerprint = real_fp(session, plan)
            if state["done"] or session is not self.session:
                return fingerprint
            state["done"] = True
            session.rollback()
            other = self.session_factory()
            try:
                winner = adjustment_service.confirm_adjustment(
                    other, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
                )
                state["winner_ids"] = list(winner.applied_record["created_ids"])
                self.assertEqual(winner.status, "confirmed")
            finally:
                other.close()
            return fingerprint

        with patch(
            "app.services.adjustment_service.basis_fingerprint", side_effect=wrapped
        ):
            resumed = adjustment_service.confirm_adjustment(
                self.session, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
            )
        self.assertEqual(resumed.status, "confirmed")
        self.assertEqual(
            list(resumed.applied_record["created_ids"]), state["winner_ids"]
        )
        self.session.expire_all()
        stored = self.session.get(PlanAdjustment, preview.id)
        self.assertEqual(stored.status, "confirmed")
        self.assertEqual(stored.applied_record["created_ids"], state["winner_ids"])
        self.assertFalse(
            any(
                isinstance(step, dict) and step.get("result") == "conflict"
                for step in (stored.steps or [])
            )
        )
        created = list(
            self.session.scalars(
                select(DailyTask).where(
                    DailyTask.plan_id == self.plan.id,
                    DailyTask.description.like("明确任务%"),
                )
            )
        )
        self.assertEqual(len(created), 2)

    async def test_d1_conflict_write_does_not_overwrite_rejected_or_undone(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "拒绝保护",
            None,
            [],
            self._gen(),
        )
        adjustment_service.reject_adjustment(
            self.session, self.user.id, self.plan.id, preview.id
        )
        rejected = self.session.get(PlanAdjustment, preview.id)
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service._mark_confirm_conflict(
                self.session, rejected, "basis_changed"
            )
        self.session.expire_all()
        self.assertEqual(self.session.get(PlanAdjustment, preview.id).status, "rejected")

        preview2 = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "撤销保护",
            None,
            [],
            self._gen(),
        )
        adjustment_service.confirm_adjustment(
            self.session, self.user.id, self.plan.id, preview2.id, expected_selection_version=preview2.proposal["selectionVersion"]
        )
        adjustment_service.undo_latest(self.session, self.user.id, self.plan.id)
        undone = self.session.get(PlanAdjustment, preview2.id)
        self.assertEqual(undone.status, "undone")
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service._mark_confirm_conflict(
                self.session, undone, "basis_changed"
            )
        self.session.expire_all()
        kept = self.session.get(PlanAdjustment, preview2.id)
        self.assertEqual(kept.status, "undone")
        self.assertIsNotNone(kept.applied_record)

    async def test_d2_undo_conflicts_when_task_completed_before_claim(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "撤销交错",
            None,
            [],
            self._gen(),
        )
        confirmed = adjustment_service.confirm_adjustment(
            self.session, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
        )
        created_task_id = uuid.UUID(confirmed.applied_record["created_ids"][0])
        real_check = adjustment_service._assert_undo_still_safe
        calls = {"n": 0}

        def wrapped(session, plan, row, today):
            calls["n"] += 1
            real_check(session, plan, row, today)
            if calls["n"] == 1:
                other = self.session_factory()
                try:
                    task_service.set_task_status(
                        other, self.user.id, created_task_id, "done"
                    )
                finally:
                    other.close()

        adjustment_service._assert_undo_still_safe = wrapped
        try:
            with self.assertRaises(adjustment_service.AdjustmentConflictError):
                adjustment_service.undo_latest(
                    self.session, self.user.id, self.plan.id
                )
        finally:
            adjustment_service._assert_undo_still_safe = real_check
        self.assertGreaterEqual(calls["n"], 2)
        self.session.expire_all()
        self.assertEqual(
            self.session.get(PlanAdjustment, confirmed.id).status, "confirmed"
        )
        done_task = self.session.get(DailyTask, created_task_id)
        self.assertIsNotNone(done_task)
        self.assertEqual(done_task.status, "done")
        phase = self.session.get(Phase, done_task.phase_id)
        self.assertIsNotNone(phase)
        self.assertGreater(phase.progress_percent, 0)
        self.assertEqual(
            len(
                list(
                    self.session.scalars(
                        select(DailyTask).where(
                            DailyTask.plan_id == self.plan.id,
                            DailyTask.description.like("明确任务%"),
                        )
                    )
                )
            ),
            2,
        )

    async def test_d2_task_completed_after_last_preclaim_check(self) -> None:
        """B commits done after the last pre-claim check and before the status UPDATE."""
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "最后窗口",
            None,
            [],
            self._gen(),
        )
        confirmed = adjustment_service.confirm_adjustment(
            self.session, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
        )
        created_ids = [uuid.UUID(item) for item in confirmed.applied_record["created_ids"]]
        target_id = created_ids[0]
        practice = PracticeQuestion(
            user_id=self.user.id,
            source="generated",
            question="关联",
            answer="",
            explanation="",
            status="pending",
            source_task_id=target_id,
        )
        self.session.add(practice)
        self.session.commit()
        practice_id = practice.id
        phase_id = self.session.get(DailyTask, target_id).phase_id
        interleaved = {"n": 0}

        def before_status_update(state) -> None:
            if not state.is_update:
                return
            compiled = state.statement.compile(compile_kwargs={"render_postcompile": True})
            params = dict(compiled.params)
            if params.get("status") != "undone":
                return
            interleaved["n"] += 1
            if interleaved["n"] != 1:
                return
            other = self.session_factory()
            try:
                task_service.set_task_status(other, self.user.id, target_id, "done")
            finally:
                other.close()

        event.listen(self.session, "do_orm_execute", before_status_update)
        caught = None
        try:
            adjustment_service.undo_latest(self.session, self.user.id, self.plan.id)
        except adjustment_service.AdjustmentConflictError as exc:
            caught = exc
        finally:
            event.remove(self.session, "do_orm_execute", before_status_update)
        self.assertEqual(interleaved["n"], 1)
        self.assertIsNotNone(caught)
        self.assertEqual(interleaved["n"], 1)
        self.session.expire_all()
        stored = self.session.get(PlanAdjustment, confirmed.id)
        self.assertEqual(stored.status, "confirmed")
        self.assertFalse(
            any(
                isinstance(step, dict) and step.get("step") == "undo" and step.get("result") == "ok"
                for step in (stored.steps or [])
            )
        )
        done_task = self.session.get(DailyTask, target_id)
        self.assertIsNotNone(done_task)
        self.assertEqual(done_task.status, "done")
        self.assertEqual(done_task.phase_id, phase_id)
        phase = self.session.get(Phase, phase_id)
        self.assertIsNotNone(phase)
        self.assertGreater(phase.progress_percent, 0)
        linked = self.session.get(PracticeQuestion, practice_id)
        self.assertEqual(linked.source_task_id, target_id)
        remaining = list(
            self.session.scalars(
                select(DailyTask).where(
                    DailyTask.plan_id == self.plan.id,
                    DailyTask.description.like("明确任务%"),
                )
            )
        )
        self.assertEqual(len(remaining), len(created_ids))
        self.assertIsNone(self.session.get(DailyTask, self.pending.id))

    async def test_d2_other_writer_cannot_commit_while_undo_holds_lock(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "写入权",
            None,
            [],
            self._gen(),
        )
        confirmed = adjustment_service.confirm_adjustment(
            self.session, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
        )
        target_id = uuid.UUID(confirmed.applied_record["created_ids"][0])
        busy_engine = create_engine(
            f"sqlite:///{self._db_path.as_posix()}",
            connect_args={"check_same_thread": False, "timeout": 0.05},
        )
        busy_factory = sessionmaker(bind=busy_engine, class_=Session, expire_on_commit=False)
        probe = {"attempts": 0, "committed": False, "error": None, "status_during": None}

        def during_claim(conn, cursor, statement, parameters, context, executemany) -> None:  # noqa: ANN001
            sql = str(statement).lstrip().lower()
            blob = str(parameters).lower()
            if probe["attempts"] or not sql.startswith("update") or "plan_adjustment" not in sql:
                return
            if "undone" not in blob:
                return
            probe["attempts"] += 1
            other = busy_factory()
            try:
                task_service.set_task_status(other, self.user.id, target_id, "done")
                probe["committed"] = True
            except Exception as exc:  # noqa: BLE001 — lock failure is the expected evidence
                probe["error"] = type(exc).__name__
            finally:
                other.close()
            checker = self.session_factory()
            try:
                task = checker.get(DailyTask, target_id)
                probe["status_during"] = None if task is None else task.status
            finally:
                checker.close()

        event.listen(self.engine, "after_cursor_execute", during_claim)
        try:
            undone = adjustment_service.undo_latest(
                self.session, self.user.id, self.plan.id
            )
        finally:
            event.remove(self.engine, "after_cursor_execute", during_claim)
            busy_engine.dispose()
        self.assertEqual(probe["attempts"], 1)
        self.assertFalse(probe["committed"], probe)
        self.assertIsNotNone(probe["error"], probe)
        self.assertEqual(probe["status_during"], "pending")
        self.assertEqual(undone.status, "undone")
        self.session.expire_all()
        self.assertIsNone(self.session.get(DailyTask, target_id))


if __name__ == "__main__":
    unittest.main()
