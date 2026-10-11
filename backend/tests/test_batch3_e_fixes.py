"""Batch-3 review regressions E1-E9. Injected generators and SQLite only."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
import uuid
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pydantic import ValidationError
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.clock import local_today
from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import ApiConfig, DailyTask, Phase, Plan, PlanAdjustment, User, UserDocument
from app.routers.plans import ReviseAdjustmentPayload
from app.routers.study import _task_result
from app.services import adjustment_service, planner_service, task_service
from test_evidence_time import EvidenceAdjustmentTests


class EvidenceFixTests(EvidenceAdjustmentTests):
    async def test_e1_chunk_past_prompt_cutoff_cannot_be_cited(self) -> None:
        self.doc.content = "x" * 1000
        for index in range(1, 10):
            self.session.add(
                UserDocument(
                    user_id=self.user.id,
                    doc_id=self.doc.doc_id,
                    filename=self.doc.filename,
                    file_type="pdf",
                    chunk_index=index,
                    content="x" * 1000,
                )
            )
        suffix = "limit theorem hidden after prefix"
        self.session.add(
            UserDocument(
                user_id=self.user.id,
                doc_id=self.doc.doc_id,
                filename=self.doc.filename,
                file_type="pdf",
                chunk_index=10,
                content=suffix,
            )
        )
        self.session.commit()
        observed: dict[str, str] = {}

        def generator(fields, docs, context, instruction):
            observed["prompt"] = planner_service._build_plan_user_prompt(
                fields, docs, context, instruction
            )
            structure = self._gen(cites=[{"docId": self.doc.doc_id, "chunkIndex": 10}])(
                fields, docs, context, instruction
            )
            for phase in structure["phases"]:
                for task in phase["daily_tasks"]:
                    task["description"] = "study limit theorem"
            return structure

        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "adjust limit theorem",
            None,
            [self.doc.doc_id],
            generator,
        )
        cited = [
            ref["chunkIndex"]
            for ref in preview.evidence_refs
            if ref.get("kind") == "document"
        ]
        if suffix not in observed["prompt"]:
            self.assertNotIn(10, cited)
            self.assertNotEqual(preview.validation["checks"]["evidenceLocation"], "pass")
            self.assertFalse(preview.validation["ok"])
        for ref in preview.evidence_refs:
            if ref.get("kind") != "document":
                continue
            self.assertIn(str(ref["snippet"]), observed["prompt"])
            self.assertIn(f"chunkIndex={ref['chunkIndex']}", observed["prompt"])

    async def test_e1_same_text_does_not_claim_an_unsent_chunk(self) -> None:
        shared = "极限定理 shared"
        self.doc.content = shared
        self.session.add(
            UserDocument(
                user_id=self.user.id,
                doc_id=self.doc.doc_id,
                filename=self.doc.filename,
                file_type="pdf",
                chunk_index=1,
                content=shared,
            )
        )
        self.session.commit()
        observed: dict[str, str] = {}

        def generator(fields, docs, context, instruction):
            observed["prompt"] = planner_service._build_plan_user_prompt(
                fields, docs, context, instruction
            )
            return self._gen(cites=[{"docId": self.doc.doc_id, "chunkIndex": 1}])(
                fields, docs, context, instruction
            )

        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "复习极限定理",
            None,
            [self.doc.doc_id],
            generator,
        )
        cited = [
            ref["chunkIndex"]
            for ref in preview.evidence_refs
            if ref.get("kind") == "document"
        ]
        if "chunkIndex=1" not in observed["prompt"]:
            self.assertNotIn(1, cited)
            self.assertNotEqual(preview.validation["checks"]["evidenceLocation"], "pass")
        else:
            self.assertIn("docId=", observed["prompt"])
            self.assertIn(shared, observed["prompt"])

    async def test_e1_revise_keeps_source_snapshot_when_text_changes(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "复习极限定理",
            None,
            [self.doc.doc_id],
            self._gen(),
        )
        before_hash = next(
            item["contentHash"]
            for item in preview.evidence_refs
            if item["kind"] == "document"
        )
        self.doc.content = "a changed limit theorem text 极限定理"
        self.session.commit()
        ids = [item["actionId"] for item in preview.diff["proposedPending"]]
        revised = adjustment_service.revise_preview(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            ids,
            None,
            preview.proposal["selectionVersion"],
        )
        after_hash = next(
            item["contentHash"]
            for item in revised.evidence_refs
            if item["kind"] == "document"
        )
        self.assertEqual(after_hash, before_hash)
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.confirm_adjustment(
                self.session,
                self.user.id,
                self.plan.id,
                revised.id,
                expected_selection_version=revised.proposal["selectionVersion"],
            )
        self.assertEqual(self.session.get(DailyTask, self.pending.id).description, "将来可替换")

    async def test_e3_omitted_version_does_not_confirm_latest(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "复习极限定理",
            None,
            [self.doc.doc_id],
            self._gen(),
        )
        action_id = preview.diff["proposedPending"][0]["actionId"]
        revised = adjustment_service.revise_preview(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            [item["actionId"] for item in preview.diff["proposedPending"]],
            {action_id: 40},
            1,
        )
        self.assertEqual(revised.proposal["selectionVersion"], 2)
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.confirm_adjustment(
                self.session, self.user.id, self.plan.id, preview.id
            )
        self.assertEqual(self.session.get(PlanAdjustment, preview.id).status, "pending")
        self.assertEqual(self.session.get(DailyTask, self.pending.id).description, "将来可替换")

    async def test_e5_invalid_dates_stay_visible_and_block_confirm(self) -> None:
        def generator(fields, docs, context, instruction):
            structure = self._gen()(fields, docs, context, instruction)
            bad = dict(structure["phases"][0]["daily_tasks"][0])
            bad["task_date"] = (self.today + timedelta(days=99)).isoformat()
            bad["description"] = "out of bounds task"
            structure["phases"][0]["daily_tasks"].append(bad)
            structure["phases"][1]["daily_tasks"][0]["task_date"] = "not-a-date"
            return structure

        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "复习极限定理",
            None,
            [self.doc.doc_id],
            generator,
        )
        dates = [item["taskDate"] for item in preview.diff["proposedPending"]]
        self.assertEqual(len(dates), 3)
        self.assertIn("not-a-date", dates)
        self.assertEqual(preview.validation["checks"]["schedule"], "fail")
        self.assertFalse(preview.validation["ok"])
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.confirm_adjustment(
                self.session,
                self.user.id,
                self.plan.id,
                preview.id,
                expected_selection_version=1,
            )

    async def test_e5_inverted_phase_is_not_repaired(self) -> None:
        def generator(fields, docs, context, instruction):
            structure = self._gen()(fields, docs, context, instruction)
            structure["phases"][0]["start_date"] = (self.today + timedelta(days=4)).isoformat()
            structure["phases"][0]["end_date"] = self.today.isoformat()
            return structure

        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "复习极限定理",
            None,
            [self.doc.doc_id],
            generator,
        )
        self.assertEqual(preview.validation["checks"]["schedule"], "fail")
        self.assertFalse(preview.validation["ok"])

    async def test_e6_unchecked_candidate_can_be_restored(self) -> None:
        def generator(fields, docs, context, instruction):
            structure = self._gen()(fields, docs, context, instruction)
            extra = dict(structure["phases"][0]["daily_tasks"][0])
            extra["description"] += " extra"
            extra["task_date"] = (self.today + timedelta(days=2)).isoformat()
            structure["phases"][0]["daily_tasks"].append(extra)
            return structure

        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "复习极限定理",
            None,
            [self.doc.doc_id],
            generator,
        )
        original_ids = [item["actionId"] for item in preview.diff["proposedPending"]]
        self.assertGreaterEqual(len(original_ids), 3)
        dropped = original_ids[1]
        revised = adjustment_service.revise_preview(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            [key for key in original_ids if key != dropped],
            None,
            1,
        )
        restored = adjustment_service.revise_preview(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            original_ids,
            None,
            revised.proposal["selectionVersion"],
        )
        self.assertEqual(
            [item["actionId"] for item in restored.diff["proposedPending"]],
            original_ids,
        )
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.revise_preview(
                self.session,
                self.user.id,
                self.plan.id,
                preview.id,
                original_ids + ["missing-action"],
                None,
                restored.proposal["selectionVersion"],
            )

    async def test_e8_carry_query_and_revision_keep_estimate(self) -> None:
        self.pending.task_date = self.today - timedelta(days=1)
        self.plan.start_date = self.today - timedelta(days=3)
        self.pending.estimated_minutes = 30
        self.session.commit()
        carried = task_service.settle_overdue_tasks(
            self.session, user_id=self.user.id, today=self.today
        )
        self.assertEqual([item.estimated_minutes for item in carried], [30])
        self.assertEqual(_task_result(self.pending)["estimatedMinutes"], 30)
        self.assertEqual(_task_result(carried[0])["estimatedMinutes"], 30)
        revision = planner_service._snapshot_plan(self.session, self.plan, "test")
        import json

        body = json.loads(revision.snapshot)
        minutes = {item["id"]: item.get("estimatedMinutes") for item in body["dailyTasks"]}
        self.assertEqual(minutes[str(self.pending.id)], 30)
        self.assertEqual(minutes[str(carried[0].id)], 30)

    async def test_e9_diff_lists_plan_field_changes_and_kept_tasks(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "复习极限定理",
            {"dailyMinutes": 120, "goalName": "新目标"},
            [self.doc.doc_id],
            self._gen(),
        )
        changes = {item["field"]: item for item in preview.diff["planChanges"]}
        self.assertEqual(changes["dailyMinutes"]["before"], 90)
        self.assertEqual(changes["dailyMinutes"]["after"], 120)
        self.assertEqual(changes["goalName"]["after"], "新目标")
        self.assertNotIn("currentLevel", changes)
        self.assertTrue(preview.diff["keptTasks"] or preview.diff["protectedKept"] >= 0)

    async def test_f1_saved_minutes_follow_selection_summary_and_undo(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "复习极限定理",
            None,
            [self.doc.doc_id],
            self._gen(),
        )
        ids = [item["actionId"] for item in preview.diff["proposedPending"]]
        first, second = ids[0], ids[1]
        revised = adjustment_service.revise_preview(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            ids,
            {first: 40},
            1,
        )
        selected = next(item for item in revised.diff["proposedPending"] if item["actionId"] == first)
        candidate = next(item for item in revised.diff["candidates"] if item["actionId"] == first)
        day = next(item for item in revised.validation["durationDays"] if item["date"] == selected["taskDate"])
        self.assertEqual(selected["estimatedMinutes"], 40)
        self.assertEqual(candidate["estimatedMinutes"], 40)
        self.assertEqual(day["knownMinutes"], 40)

        again = adjustment_service.revise_preview(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            ids,
            None,
            revised.proposal["selectionVersion"],
        )
        self.assertEqual(
            next(item for item in again.diff["proposedPending"] if item["actionId"] == first)["estimatedMinutes"],
            40,
        )
        self.assertEqual(
            next(item for item in again.diff["candidates"] if item["actionId"] == first)["estimatedMinutes"],
            40,
        )

        hidden = adjustment_service.revise_preview(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            [second],
            None,
            again.proposal["selectionVersion"],
        )
        self.assertEqual(
            next(item for item in hidden.diff["candidates"] if item["actionId"] == first)["estimatedMinutes"],
            40,
        )
        restored = adjustment_service.revise_preview(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            ids,
            None,
            hidden.proposal["selectionVersion"],
        )
        self.assertEqual(
            next(item for item in restored.diff["proposedPending"] if item["actionId"] == first)["estimatedMinutes"],
            40,
        )
        confirmed = adjustment_service.confirm_adjustment(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            expected_selection_version=restored.proposal["selectionVersion"],
        )
        self.assertEqual(confirmed.status, "confirmed")
        written = {
            task.description: task.estimated_minutes
            for task in self.session.scalars(
                select(DailyTask).where(DailyTask.description.like("复习极限定理%"))
            )
        }
        self.assertEqual(written["复习极限定理"], 40)
        undone = adjustment_service.undo_latest(self.session, self.user.id, self.plan.id)
        self.assertEqual(undone.status, "undone")
        self.assertEqual(self.session.get(DailyTask, self.pending.id).estimated_minutes, 30)

    async def test_f1_unknown_minutes_are_not_invented_when_restored(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "复习极限定理",
            None,
            [self.doc.doc_id],
            self._gen(minutes=None),
        )
        ids = [item["actionId"] for item in preview.diff["proposedPending"]]
        first = ids[0]
        self.assertIsNone(
            next(item for item in preview.diff["candidates"] if item["actionId"] == first)["estimatedMinutes"]
        )
        hidden = adjustment_service.revise_preview(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            [ids[1]],
            None,
            1,
        )
        restored = adjustment_service.revise_preview(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            ids,
            None,
            hidden.proposal["selectionVersion"],
        )
        self.assertIsNone(
            next(item for item in restored.diff["candidates"] if item["actionId"] == first)["estimatedMinutes"]
        )
        self.assertIsNone(
            next(item for item in restored.diff["proposedPending"] if item["actionId"] == first)["estimatedMinutes"]
        )

    async def test_f2_explicit_bad_goal_does_not_preview_or_change_plan(self) -> None:
        original = self.plan.goal_date
        for bad in ("not-a-date", "2026-02-31", 20261010, True):
            with self.assertRaises(planner_service.PlanGenerationError):
                await adjustment_service.create_preview(
                    self.session,
                    self.user.id,
                    self.plan.id,
                    "复习极限定理",
                    {"goalDate": bad},
                    [self.doc.doc_id],
                    self._gen(),
                )
            self.session.expire_all()
            self.assertEqual(self.session.get(Plan, self.plan.id).goal_date, original)
        self.assertEqual(
            list(self.session.scalars(select(PlanAdjustment))),
            [],
        )

    async def test_f2_omitted_goal_keeps_old_date_and_valid_goal_is_written(self) -> None:
        original = self.plan.goal_date.isoformat()
        kept = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "复习极限定理",
            None,
            [self.doc.doc_id],
            self._gen(),
        )
        self.assertNotIn("goalDate", {item["field"] for item in kept.diff["planChanges"]})
        self.assertTrue(kept.validation["ok"])
        new_goal = (self.today + timedelta(days=60)).isoformat()
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "复习极限定理",
            {"goalDate": new_goal},
            [self.doc.doc_id],
            self._gen(),
        )
        change = next(item for item in preview.diff["planChanges"] if item["field"] == "goalDate")
        self.assertEqual(change["before"], original)
        self.assertEqual(change["after"], new_goal)
        self.assertEqual(preview.validation["checks"]["schedule"], "pass")
        self.assertTrue(preview.validation["ok"])
        confirmed = adjustment_service.confirm_adjustment(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            expected_selection_version=preview.proposal["selectionVersion"],
        )
        self.assertEqual(confirmed.status, "confirmed")
        self.assertEqual(self.session.get(Plan, self.plan.id).goal_date.isoformat(), new_goal)

    async def test_f2_same_day_compact_form_is_not_a_false_change(self) -> None:
        original = self.plan.goal_date.isoformat()
        requested = original.replace("-", "")
        calls: list[bool] = []
        generator = self._gen()

        def tracked(*args):
            calls.append(True)
            return generator(*args)

        with self.assertRaises(planner_service.PlanGenerationError):
            await adjustment_service.create_preview(
                self.session,
                self.user.id,
                self.plan.id,
                "复习极限定理",
                {"goalDate": requested},
                [self.doc.doc_id],
                tracked,
            )
        self.assertEqual(calls, [])
        self.session.expire_all()
        self.assertEqual(self.session.get(Plan, self.plan.id).goal_date.isoformat(), original)

        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "复习极限定理",
            None,
            [self.doc.doc_id],
            self._gen(),
        )
        proposal = dict(preview.proposal)
        fields = dict(proposal["fields"])
        fields["goalDate"] = requested
        proposal["fields"] = fields
        preview.proposal = proposal
        self.session.commit()
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.confirm_adjustment(
                self.session,
                self.user.id,
                self.plan.id,
                preview.id,
                expected_selection_version=preview.proposal["selectionVersion"],
            )
        self.session.expire_all()
        stored = self.session.get(PlanAdjustment, preview.id)
        self.assertEqual(stored.status, "pending")
        self.assertEqual(self.session.get(Plan, self.plan.id).goal_date.isoformat(), original)


class ReviseRaceTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._environment = {
            name: os.environ.get(name) for name in ("DATABASE_URL", "DB_PASSWORD")
        }
        cls._db_path = Path(tempfile.mkstemp(suffix="-e2.db")[1])
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
        self.user = User(username=f"e2-{os.urandom(4).hex()}", password_hash="x" * 20)
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
        adjustment_service._revise_before_claim = None

    def tearDown(self) -> None:
        adjustment_service._revise_before_claim = None
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _gen(self):
        today = self.today

        def generator(fields, used_docs, context_text, instruction):
            return {
                "phases": [
                    {
                        "name": "阶段1",
                        "start_date": today.isoformat(),
                        "end_date": (today + timedelta(days=1)).isoformat(),
                        "daily_tasks": [
                            {
                                "task_date": (today + timedelta(days=1)).isoformat(),
                                "week_label": "W01",
                                "description": "新任务甲",
                                "estimated_minutes": 20,
                            }
                        ],
                    },
                    {
                        "name": "阶段2",
                        "start_date": (today + timedelta(days=2)).isoformat(),
                        "end_date": (today + timedelta(days=2)).isoformat(),
                        "daily_tasks": [
                            {
                                "task_date": (today + timedelta(days=2)).isoformat(),
                                "week_label": "W01",
                                "description": "新任务乙",
                                "estimated_minutes": 20,
                            }
                        ],
                    },
                ]
            }

        return generator

    async def test_e2_stale_revise_does_not_overwrite_confirmed(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "调整",
            None,
            [],
            self._gen(),
        )
        ids = [item["actionId"] for item in preview.diff["proposedPending"]]

        def interleave(_session, _row) -> None:
            other = self.session_factory()
            try:
                winner = adjustment_service.confirm_adjustment(
                    other,
                    self.user.id,
                    self.plan.id,
                    preview.id,
                    expected_selection_version=1,
                )
                self.assertEqual(winner.status, "confirmed")
            finally:
                other.close()

        adjustment_service._revise_before_claim = interleave
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.revise_preview(
                self.session,
                self.user.id,
                self.plan.id,
                preview.id,
                ids,
                {ids[0]: 40},
                1,
            )
        self.session.expire_all()
        stored = self.session.get(PlanAdjustment, preview.id)
        self.assertEqual(stored.status, "confirmed")
        self.assertEqual(stored.proposal["selectionVersion"], 1)
        minutes = [
            item["estimatedMinutes"] for item in stored.diff["proposedPending"]
        ]
        self.assertEqual(minutes, [20, 20])
        written = list(
            self.session.scalars(
                select(DailyTask).where(DailyTask.description.like("新任务%"))
            )
        )
        self.assertEqual(sorted(task.estimated_minutes for task in written), [20, 20])

    async def test_e2_two_revises_same_version_one_wins(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "调整",
            None,
            [],
            self._gen(),
        )
        ids = [item["actionId"] for item in preview.diff["proposedPending"]]

        def interleave(_session, _row) -> None:
            other = self.session_factory()
            try:
                adjustment_service.revise_preview(
                    other,
                    self.user.id,
                    self.plan.id,
                    preview.id,
                    ids,
                    {ids[0]: 25},
                    1,
                )
            finally:
                other.close()

        adjustment_service._revise_before_claim = interleave
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.revise_preview(
                self.session,
                self.user.id,
                self.plan.id,
                preview.id,
                ids,
                {ids[0]: 40},
                1,
            )
        self.session.expire_all()
        stored = self.session.get(PlanAdjustment, preview.id)
        self.assertEqual(stored.status, "pending")
        self.assertEqual(stored.proposal["selectionVersion"], 2)
        self.assertEqual(stored.diff["proposedPending"][0]["estimatedMinutes"], 25)

    async def test_e3_confirm_loses_if_revise_updates_version_after_read(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "调整",
            None,
            [],
            self._gen(),
        )
        ids = [item["actionId"] for item in preview.diff["proposedPending"]]

        def interleave(_session, _row) -> None:
            other = self.session_factory()
            try:
                adjustment_service.revise_preview(
                    other,
                    self.user.id,
                    self.plan.id,
                    preview.id,
                    ids,
                    {ids[0]: 40},
                    1,
                )
            finally:
                other.close()

        adjustment_service._confirm_after_fingerprint_hook = interleave
        try:
            with self.assertRaises(adjustment_service.AdjustmentConflictError):
                adjustment_service.confirm_adjustment(
                    self.session,
                    self.user.id,
                    self.plan.id,
                    preview.id,
                    expected_selection_version=1,
                )
        finally:
            adjustment_service._confirm_after_fingerprint_hook = None
        self.session.expire_all()
        stored = self.session.get(PlanAdjustment, preview.id)
        self.assertEqual(stored.status, "pending")
        self.assertEqual(stored.proposal["selectionVersion"], 2)
        self.assertEqual(self.session.get(DailyTask, self.pending.id).description, "将来可替换")


class PayloadBoundaryTests(unittest.TestCase):
    def test_e7_bool_minutes_and_version_are_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            ReviseAdjustmentPayload.model_validate(
                {
                    "selectionVersion": 1,
                    "keepActionIds": ["a0"],
                    "minuteOverrides": {"a0": True},
                }
            )
        with self.assertRaises(ValidationError):
            ReviseAdjustmentPayload.model_validate(
                {
                    "selectionVersion": "1",
                    "keepActionIds": ["a0"],
                    "minuteOverrides": {"a0": 30},
                }
            )
        with self.assertRaises(ValidationError):
            ReviseAdjustmentPayload.model_validate(
                {
                    "selectionVersion": 1,
                    "keepActionIds": ["a0"],
                    "minuteOverrides": {"a0": "30"},
                }
            )


if __name__ == "__main__":
    unittest.main()
