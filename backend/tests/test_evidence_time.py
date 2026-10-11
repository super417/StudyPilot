"""Batch-3 evidence location and duration checks. No paid model."""

from __future__ import annotations

import os
import unittest
import uuid
from datetime import timedelta

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.clock import local_today
from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import ApiConfig, DailyTask, Phase, Plan, User, UserDocument
from app.services import adjustment_service, document_service, evidence_time
from app.services.evidence_time import parse_estimated_minutes


class EvidenceTimeUnitTests(unittest.TestCase):
    def test_overlap_finds_chinese_and_english_terms_without_score(self) -> None:
        terms = evidence_time.overlap_terms("复习 limit 定理", "本章讨论极限定理 limit")
        self.assertIn("定理", terms)
        self.assertIn("limit", terms)
        self.assertNotIn("score", terms)
        self.assertFalse(any(isinstance(item, float) for item in terms))

    def test_fabricated_citation_is_not_replaced(self) -> None:
        candidates = [{"docId": "d1", "chunkIndex": 0, "content": "极限定理"}]
        accepted, fabricated = evidence_time.check_model_citations(
            candidates, [{"docId": "missing", "chunkIndex": 0}]
        )
        self.assertEqual(accepted, [])
        self.assertEqual(len(fabricated), 1)

    def test_prompt_truncation_drops_chunks_that_did_not_enter(self) -> None:
        hits = [
            {"snippet": "进入了的片段"},
            {"snippet": "被截掉的片段"},
        ]
        kept = evidence_time.citations_in_prompt(hits, "事实：进入了的片段")
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0]["snippet"], "进入了的片段")

    def test_minutes_reject_junk_and_keep_absent_unknown(self) -> None:
        self.assertIsNone(parse_estimated_minutes(None))
        self.assertEqual(parse_estimated_minutes(30), 30)
        for bad in (0, -3, True, False, "30", 1.5):
            with self.assertRaises(ValueError):
                parse_estimated_minutes(bad)

    def test_duration_cap_is_inclusive_and_unknown_is_not_zero(self) -> None:
        today = local_today()
        report = evidence_time.duration_report(
            [(today, 40), (today, 50), (today - timedelta(days=1), 999)],
            cap=90,
            today=today,
            goal=today + timedelta(days=2),
        )
        self.assertEqual(report["result"], "pass")
        over = evidence_time.duration_report(
            [(today, 40), (today, 51)], 90, today, today
        )
        self.assertEqual(over["result"], "fail")
        unknown = evidence_time.duration_report(
            [(today, None), (today, 10)], 90, today, today
        )
        self.assertEqual(unknown["result"], "unknown")
        self.assertEqual(unknown["days"][0]["knownMinutes"], 10)

    def test_goal_before_protected_history_fails_without_moving_it(self) -> None:
        today = local_today()
        phases = [
            {
                "start_date": today.isoformat(),
                "end_date": today.isoformat(),
                "daily_tasks": [{"task_date": today.isoformat()}],
            }
        ]
        self.assertEqual(
            evidence_time.check_schedule_order(
                phases, today, [today + timedelta(days=3)]
            ),
            "fail",
        )


class EvidenceAdjustmentTests(unittest.IsolatedAsyncioTestCase):
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
        self.user = User(username=f"ev-{os.urandom(4).hex()}", password_hash="x" * 20)
        self.other = User(username=f"ot-{os.urandom(4).hex()}", password_hash="x" * 20)
        self.session.add_all([self.user, self.other])
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
            goal_date=self.today + timedelta(days=30),
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
            task_date=self.today + timedelta(days=1),
            week_label="W01",
            description="将来可替换",
            status="pending",
            estimated_minutes=30,
        )
        self.session.add(self.pending)
        self.doc = UserDocument(
            user_id=self.user.id,
            doc_id="doc-limit",
            filename="极限.pdf",
            file_type="pdf",
            chunk_index=0,
            content="本章讨论极限定理",
            page_start=2,
        )
        self.session.add(self.doc)
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _gen(self, cites: list[dict] | None = None, minutes: int | None = 30):
        today = self.today

        def generator(fields, used_docs, context_text, instruction):
            task = {
                "task_date": (today + timedelta(days=1)).isoformat(),
                "week_label": "W01",
                "description": "复习极限定理",
            }
            if minutes is not None:
                task["estimated_minutes"] = minutes
            return {
                "phases": [
                    {
                        "name": "阶段1",
                        "start_date": today.isoformat(),
                        "end_date": (today + timedelta(days=2)).isoformat(),
                        "daily_tasks": [task],
                    },
                    {
                        "name": "阶段2",
                        "start_date": (today + timedelta(days=3)).isoformat(),
                        "end_date": (today + timedelta(days=4)).isoformat(),
                        "daily_tasks": [
                            {
                                "task_date": (today + timedelta(days=3)).isoformat(),
                                "week_label": "W01",
                                "description": "复习极限定理二",
                                "estimated_minutes": 20,
                            }
                        ],
                    },
                ],
                "citations": cites if cites is not None else [
                    {"docId": "doc-limit", "chunkIndex": 0}
                ],
            }

        return generator

    async def test_chain_cite_select_confirm_undo_restores_minutes(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "把任务改成复习极限定理",
            None,
            ["doc-limit"],
            self._gen(),
        )
        self.assertEqual(preview.validation["checks"]["evidenceLocation"], "pass")
        self.assertEqual(preview.validation["checks"]["duration"], "pass")
        self.assertTrue(preview.evidence_refs)
        kinds = {item["kind"] for item in preview.evidence_refs}
        self.assertIn("document", kinds)
        self.assertIn("constraint", kinds)
        doc_ref = next(item for item in preview.evidence_refs if item["kind"] == "document")
        self.assertEqual(doc_ref["pageStart"], 2)
        self.assertIn("定理", doc_ref["matchedTerms"])
        self.assertEqual(doc_ref["literatureSupport"], "suggestion")
        proposed = preview.diff["proposedPending"]
        self.assertTrue(all(item.get("estimatedMinutes") == 30 or item.get("estimatedMinutes") == 20 for item in proposed))
        version = preview.proposal["selectionVersion"]
        revised = adjustment_service.revise_preview(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            keep_action_ids=[item["actionId"] for item in proposed],
            minute_overrides={proposed[0]["actionId"]: 40},
            selection_version=version,
        )
        self.assertEqual(self.session.get(DailyTask, self.pending.id).description, "将来可替换")
        self.assertEqual(revised.proposal["selectionVersion"], version + 1)
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.confirm_adjustment(
                self.session,
                self.user.id,
                self.plan.id,
                preview.id,
                expected_selection_version=version,
            )
        confirmed = adjustment_service.confirm_adjustment(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            expected_selection_version=version + 1,
        )
        created = self.session.scalars(
            select(DailyTask).where(DailyTask.description.like("复习极限定理%"))
        )
        minutes = sorted(task.estimated_minutes for task in created)
        self.assertEqual(minutes, [20, 40])
        undone = adjustment_service.undo_latest(
            self.session, self.user.id, self.plan.id
        )
        self.assertEqual(undone.status, "undone")
        restored = self.session.get(DailyTask, self.pending.id)
        self.assertEqual(restored.estimated_minutes, 30)

    async def test_uncheck_does_not_remove_extra_original_tasks(self) -> None:
        today = self.today

        def generator(fields, used_docs, context_text, instruction):
            return {
                "phases": [
                    {
                        "name": "阶段1",
                        "start_date": today.isoformat(),
                        "end_date": (today + timedelta(days=2)).isoformat(),
                        "daily_tasks": [
                            {
                                "task_date": (today + timedelta(days=1)).isoformat(),
                                "week_label": "W01",
                                "description": "复习极限定理甲",
                                "estimated_minutes": 20,
                            },
                            {
                                "task_date": (today + timedelta(days=2)).isoformat(),
                                "week_label": "W01",
                                "description": "复习极限定理乙",
                                "estimated_minutes": 20,
                            },
                        ],
                    },
                    {
                        "name": "阶段2",
                        "start_date": (today + timedelta(days=3)).isoformat(),
                        "end_date": (today + timedelta(days=3)).isoformat(),
                        "daily_tasks": [
                            {
                                "task_date": (today + timedelta(days=3)).isoformat(),
                                "week_label": "W01",
                                "description": "复习极限定理丙",
                                "estimated_minutes": 20,
                            }
                        ],
                    },
                ],
                "citations": [{"docId": "doc-limit", "chunkIndex": 0}],
            }

        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "复习极限定理",
            None,
            ["doc-limit"],
            generator,
        )
        removed_before = [item["id"] for item in preview.diff["removedOrReplaced"]]
        proposed = preview.diff["proposedPending"]
        kept = [item["actionId"] for item in proposed if item["description"] != "复习极限定理乙"]
        revised = adjustment_service.revise_preview(
            self.session,
            self.user.id,
            self.plan.id,
            preview.id,
            keep_action_ids=kept,
            minute_overrides=None,
            selection_version=preview.proposal["selectionVersion"],
        )
        self.assertEqual(
            [item["id"] for item in revised.diff["removedOrReplaced"]],
            removed_before,
        )
        self.assertEqual(len(revised.diff["proposedPending"]), len(proposed) - 1)
        self.assertEqual(self.session.get(DailyTask, self.pending.id).description, "将来可替换")

    async def test_over_cap_preview_is_saved_but_not_confirmed(self) -> None:
        today = self.today

        def generator(fields, used_docs, context_text, instruction):
            return {
                "phases": [
                    {
                        "name": "阶段1",
                        "start_date": today.isoformat(),
                        "end_date": today.isoformat(),
                        "daily_tasks": [
                            {
                                "task_date": today.isoformat(),
                                "week_label": "W01",
                                "description": "复习极限定理",
                                "estimated_minutes": 60,
                            },
                            {
                                "task_date": today.isoformat(),
                                "week_label": "W01",
                                "description": "复习极限定理加练",
                                "estimated_minutes": 40,
                            },
                        ],
                    },
                    {
                        "name": "阶段2",
                        "start_date": (today + timedelta(days=1)).isoformat(),
                        "end_date": (today + timedelta(days=1)).isoformat(),
                        "daily_tasks": [
                            {
                                "task_date": (today + timedelta(days=1)).isoformat(),
                                "week_label": "W01",
                                "description": "复习极限定理二",
                                "estimated_minutes": 20,
                            }
                        ],
                    },
                ],
                "citations": [{"docId": "doc-limit", "chunkIndex": 0}],
            }

        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "复习极限定理",
            None,
            ["doc-limit"],
            generator,
        )
        self.assertEqual(preview.status, "pending")
        self.assertEqual(preview.validation["checks"]["duration"], "fail")
        self.assertFalse(preview.validation["ok"])
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.confirm_adjustment(
                self.session, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
            )
        self.assertEqual(self.session.get(DailyTask, self.pending.id).description, "将来可替换")

    async def test_changed_source_text_blocks_confirm(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "复习极限定理",
            None,
            ["doc-limit"],
            self._gen(),
        )
        self.doc.content = "这段文字已经换成别的内容"
        self.session.commit()
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.confirm_adjustment(
                self.session,
                self.user.id,
                self.plan.id,
                preview.id,
                expected_selection_version=preview.proposal["selectionVersion"],
            )
        self.assertEqual(self.session.get(DailyTask, self.pending.id).description, "将来可替换")

    async def test_fake_cite_and_deleted_source_do_not_pass(self) -> None:
        preview = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "复习极限定理",
            None,
            ["doc-limit"],
            self._gen(cites=[{"docId": "nope", "chunkIndex": 9}]),
        )
        self.assertEqual(preview.validation["checks"]["evidenceLocation"], "fail")
        self.assertFalse(preview.validation["ok"])
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.confirm_adjustment(
                self.session, self.user.id, self.plan.id, preview.id, expected_selection_version=preview.proposal["selectionVersion"]
            )
        good = await adjustment_service.create_preview(
            self.session,
            self.user.id,
            self.plan.id,
            "复习极限定理",
            None,
            ["doc-limit"],
            self._gen(),
        )
        self.session.delete(self.doc)
        self.session.commit()
        self.assertEqual(
            evidence_time.lookup_document_ref(
                self.session,
                self.user.id,
                {"docId": "doc-limit", "chunkIndex": 0, "filename": "极限.pdf"},
            ),
            "unavailable",
        )
        with self.assertRaises(adjustment_service.AdjustmentConflictError):
            adjustment_service.confirm_adjustment(
                self.session,
                self.user.id,
                self.plan.id,
                good.id,
                expected_selection_version=good.proposal["selectionVersion"],
            )
        self.assertEqual(self.session.get(DailyTask, self.pending.id).description, "将来可替换")

    async def test_other_user_cannot_resolve_source(self) -> None:
        status = evidence_time.lookup_document_ref(
            self.session,
            self.other.id,
            {
                "docId": "doc-limit",
                "chunkIndex": 0,
                "contentHash": evidence_time.content_hash("本章讨论极限定理"),
            },
        )
        self.assertEqual(status, "unavailable")

    def test_pdf_pages_keep_real_page_and_skip_blank(self) -> None:
        stored = document_service.pages_to_stored_chunks(
            [(1, ""), (2, "极限定理正文")]
        )
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]["page_start"], 2)
        self.assertIn("极限", stored[0]["content"])


if __name__ == "__main__":
    unittest.main()
