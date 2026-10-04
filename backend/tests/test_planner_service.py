import base64
import json
import os
import unittest
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import ApiConfig, DailyTask, Phase, Plan, User, UserDocument
from app.services import planner_service
from app.services.api_config_service import NoVerifiedApiConfigError
from app.services.plan_draft_store import MAX_CLARIFY_ROUNDS, PlanDraft
from app.services.planner_service import (
    ClarifyOutcome,
    GenerateOutcome,
    PlanGenerationError,
    advance_state,
    generate_plan,
    missing_fields,
)


def _complete_payload() -> dict:
    return {
        "goalName": "考研数学",
        "goalDate": "2025-12-21",
        "currentLevel": "零基础",
        "dailyMinutes": 120,
    }


def _plan_structure(phase_count: int) -> dict:
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
                        "description": f"阶段{i + 1}任务A",
                    },
                    {
                        "task_date": "2025-01-02",
                        "week_label": "W01",
                        "description": f"阶段{i + 1}任务B",
                    },
                ],
            }
            for i in range(phase_count)
        ]
    }


class MissingFieldsTests(unittest.TestCase):
    def test_complete_payload_has_no_missing_fields(self) -> None:
        self.assertEqual(missing_fields(_complete_payload()), [])

    def test_each_single_missing_field_detected(self) -> None:
        for field in ("goalName", "goalDate", "currentLevel", "dailyMinutes"):
            payload = _complete_payload()
            del payload[field]
            with self.subTest(field=field):
                self.assertEqual(missing_fields(payload), [field])

    def test_multiple_missing_returned_in_stable_order(self) -> None:
        self.assertEqual(
            missing_fields({"currentLevel": "中级"}),
            ["goalName", "goalDate", "dailyMinutes"],
        )
        self.assertEqual(missing_fields({}), list(planner_service.REQUIRED_FIELDS))

    def test_invalid_goal_date_counts_as_missing(self) -> None:
        payload = _complete_payload()
        payload["goalDate"] = "not-a-date"
        self.assertEqual(missing_fields(payload), ["goalDate"])
        payload["goalDate"] = "2025-13-40"
        self.assertEqual(missing_fields(payload), ["goalDate"])

    def test_non_positive_or_non_int_daily_minutes_counts_as_missing(self) -> None:
        for bad in (0, -30, "120", 12.5, True):
            payload = _complete_payload()
            payload["dailyMinutes"] = bad
            with self.subTest(value=bad):
                self.assertEqual(missing_fields(payload), ["dailyMinutes"])


class ClarifyStateMachineTests(unittest.TestCase):
    def test_round_never_exceeds_cap_and_forces_generation(self) -> None:
        # Draft starts at round 1 with no useful fields; every reply stays empty.
        draft = PlanDraft(user_id=uuid.uuid4(), fields={}, round=1)
        rounds_seen = []
        forced = False
        for _ in range(10):  # far more replies than the cap allows
            outcome = advance_state(draft, {})
            if isinstance(outcome, ClarifyOutcome):
                rounds_seen.append(outcome.round)
                self.assertLessEqual(outcome.round, MAX_CLARIFY_ROUNDS)
            else:
                self.assertIsInstance(outcome, GenerateOutcome)
                forced = outcome.forced
                break

        self.assertTrue(forced, "state machine must force generation at the cap")
        # Rounds advanced 2, 3 then forced generate at round 3 (cap == 3).
        self.assertEqual(rounds_seen, [2, 3])

    def test_completing_information_yields_generate(self) -> None:
        draft = PlanDraft(user_id=uuid.uuid4(), fields={"goalName": "考研数学"}, round=1)
        outcome = advance_state(
            draft,
            {
                "goalDate": "2025-12-21",
                "currentLevel": "零基础",
                "dailyMinutes": 120,
            },
        )
        self.assertIsInstance(outcome, GenerateOutcome)
        self.assertFalse(outcome.forced)
        self.assertEqual(missing_fields(outcome.fields), [])

    def test_partial_reply_asks_again_naming_missing(self) -> None:
        draft = PlanDraft(user_id=uuid.uuid4(), fields={}, round=1)
        outcome = advance_state(draft, {"goalName": "考研数学", "dailyMinutes": 90})
        self.assertIsInstance(outcome, ClarifyOutcome)
        self.assertEqual(outcome.round, 2)
        self.assertEqual(outcome.missing, ["goalDate", "currentLevel"])
        self.assertIn("目标日期", outcome.question)
        self.assertIn("当前水平", outcome.question)


class GeneratePlanTests(unittest.IsolatedAsyncioTestCase):
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
        self.user = User(
            username=f"planner-{os.urandom(6).hex()}",
            password_hash="x" * 20,
        )
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

    async def test_complete_info_generates_and_persists(self) -> None:
        self._add_verified_config()

        def generator(fields, used_docs, context_text, instruction):
            return _plan_structure(5)

        result = await generate_plan(
            self.session, self.user.id, _complete_payload(), [], generator
        )

        self.assertEqual(result.phases, 5)
        plan = self.session.scalar(
            select(Plan).where(Plan.user_id == self.user.id)
        )
        self.assertIsNotNone(plan)
        self.assertEqual(plan.total_phases, 5)
        self.assertEqual(plan.start_date, datetime.now(timezone.utc).date())

        phases = list(
            self.session.scalars(
                select(Phase).where(Phase.plan_id == plan.id).order_by(
                    Phase.phase_index
                )
            )
        )
        self.assertEqual([p.phase_index for p in phases], [1, 2, 3, 4, 5])
        self.assertTrue(phases[0].is_current)
        self.assertFalse(any(p.is_current for p in phases[1:]))
        self.assertTrue(all(p.progress_percent == 0 for p in phases))
        self.assertTrue(all(not p.is_completed for p in phases))

        tasks = list(
            self.session.scalars(
                select(DailyTask).where(DailyTask.plan_id == plan.id)
            )
        )
        # 2025-01-01..2025-02-01 inclusive is 32 days; gaps are filled.
        self.assertEqual(len(tasks), 5 * 32)
        self.assertTrue(all(t.status == "pending" for t in tasks))
        phase_ids = {p.id for p in phases}
        self.assertTrue(all(t.phase_id in phase_ids for t in tasks))

    async def test_missing_days_are_filled_and_given_tasks_are_kept(self) -> None:
        self._add_verified_config()

        def generator(fields, used_docs, context_text, instruction):
            return {
                "phases": [
                    {
                        "name": "数学基础",
                        "start_date": "2025-01-01",
                        "end_date": "2025-01-03",
                        "daily_tasks": [
                            {
                                "task_date": "2025-01-01",
                                "week_label": "W01",
                                "description": "数学：武忠祥强化第 3 讲极限，做例题 1-12，整理 2 道错题",
                            }
                        ],
                    },
                    {
                        "name": "英语基础",
                        "start_date": "2025-01-01",
                        "end_date": "2025-01-03",
                        "daily_tasks": [
                            {
                                "task_date": "2025-01-02",
                                "week_label": "W01",
                                "description": "英语：阅读 Unit 1，精读 1 篇，摘 5 个词",
                            }
                        ],
                    },
                ]
            }

        await generate_plan(
            self.session, self.user.id, _complete_payload(), [], generator
        )
        plan = self.session.scalar(select(Plan).where(Plan.user_id == self.user.id))
        tasks = list(
            self.session.scalars(
                select(DailyTask)
                .where(DailyTask.plan_id == plan.id)
                .order_by(DailyTask.task_date)
            )
        )
        by_phase: dict[uuid.UUID, set[date]] = {}
        kept = {task.description for task in tasks}
        for task in tasks:
            by_phase.setdefault(task.phase_id, set()).add(task.task_date)
            self.assertNotIn("继续学习", task.description)
            self.assertNotIn("复习一下", task.description)
        self.assertEqual(len(by_phase), 2)
        # The fixture starts in 2025, so it is shifted onto today. The 3-day span stays.
        today = datetime.now(timezone.utc).date()
        expected = {today, today + timedelta(days=1), today + timedelta(days=2)}
        self.assertTrue(all(days == expected for days in by_phase.values()))
        self.assertIn("数学：武忠祥强化第 3 讲极限，做例题 1-12，整理 2 道错题", kept)
        self.assertIn("英语：阅读 Unit 1，精读 1 篇，摘 5 个词", kept)

    async def test_past_schedule_is_anchored_to_today_and_not_after_goal(self) -> None:
        self._add_verified_config()

        def generator(fields, used_docs, context_text, instruction):
            return {
                "phases": [
                    {
                        "name": "基础",
                        "start_date": "2026-05-07",
                        "end_date": "2026-06-15",
                        "daily_tasks": [
                            {
                                "task_date": "2026-05-28",
                                "week_label": "W04",
                                "description": "数学：导数定义，做例题，整理 2 道错题",
                            }
                        ],
                    },
                    {
                        "name": "冲刺",
                        "start_date": "2026-11-16",
                        "end_date": "2026-12-31",
                        "daily_tasks": [
                            {
                                "task_date": "2026-12-21",
                                "week_label": "W06",
                                "description": "数学：套卷限时，整理错题",
                            }
                        ],
                    },
                ]
            }

        payload = _complete_payload()
        payload["goalDate"] = "2026-12-31"
        await generate_plan(self.session, self.user.id, payload, [], generator)
        plan = self.session.scalar(select(Plan).where(Plan.user_id == self.user.id))
        today = datetime.now(timezone.utc).date()
        phases = list(
            self.session.scalars(
                select(Phase).where(Phase.plan_id == plan.id).order_by(Phase.phase_index)
            )
        )
        tasks = list(
            self.session.scalars(select(DailyTask).where(DailyTask.plan_id == plan.id))
        )
        self.assertEqual(phases[0].start_date, today)
        self.assertGreaterEqual(phases[0].end_date, phases[0].start_date)
        self.assertLessEqual(phases[-1].end_date, date(2026, 12, 31))
        self.assertTrue(all(today <= task.task_date <= date(2026, 12, 31) for task in tasks))
        derivative = next(task for task in tasks if "导数定义" in task.description)
        self.assertEqual(derivative.task_date, date(2026, 5, 28) + (today - date(2026, 5, 7)))
        self.assertGreaterEqual(derivative.task_date, phases[0].start_date)
        self.assertLessEqual(derivative.task_date, phases[0].end_date)

    def _add_document(self, doc_id: str, chunks: list[str]) -> None:
        for index, chunk in enumerate(chunks):
            self.session.add(
                UserDocument(
                    user_id=self.user.id,
                    doc_id=doc_id,
                    filename=f"{doc_id}.txt",
                    file_type="txt",
                    chunk_index=index,
                    content=chunk,
                )
            )
        self.session.commit()

    async def test_only_ready_docs_drive_context_and_used_docs(self) -> None:
        self._add_verified_config()
        self._add_document("docA", ["ALPHA-0", "ALPHA-1"])

        captured: dict = {}

        def generator(fields, used_docs, context_text, instruction):
            captured["used_docs"] = list(used_docs)
            captured["context_text"] = context_text
            return _plan_structure(3)

        result = await generate_plan(
            self.session,
            self.user.id,
            _complete_payload(),
            ["docA", "docB"],  # docB is not ready
            generator,
        )

        self.assertEqual(result.used_docs, ["docA"])
        self.assertEqual(result.skipped_docs, ["docB"])
        self.assertEqual(captured["used_docs"], ["docA"])
        self.assertIn("ALPHA-0", captured["context_text"])
        self.assertIn("ALPHA-1", captured["context_text"])
        self.assertNotIn("docB", captured["context_text"])
        # Plan still persists normally.
        self.assertIsNotNone(
            self.session.scalar(select(Plan).where(Plan.user_id == self.user.id))
        )

    async def test_phase_count_out_of_range_raises_and_persists_nothing(self) -> None:
        self._add_verified_config()

        for bad_count in (1, 13):
            with self.subTest(count=bad_count):
                def generator(fields, used_docs, context_text, instruction, n=bad_count):
                    return _plan_structure(n)

                with self.assertRaises(PlanGenerationError):
                    await generate_plan(
                        self.session,
                        self.user.id,
                        _complete_payload(),
                        [],
                        generator,
                    )
                self.session.rollback()
                self.assertEqual(
                    list(
                        self.session.scalars(
                            select(Plan).where(Plan.user_id == self.user.id)
                        )
                    ),
                    [],
                )

    async def test_no_verified_config_raises_and_generator_not_called(self) -> None:
        called = False

        def generator(fields, used_docs, context_text, instruction):
            nonlocal called
            called = True
            return _plan_structure(3)

        with self.assertRaises(NoVerifiedApiConfigError):
            await generate_plan(
                self.session, self.user.id, _complete_payload(), [], generator
            )
        self.assertFalse(called)
        self.assertEqual(
            list(
                self.session.scalars(
                    select(Plan).where(Plan.user_id == self.user.id)
                )
            ),
            [],
        )


class RegeneratePlanTests(unittest.IsolatedAsyncioTestCase):
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
        self.user = User(
            username=f"regen-{os.urandom(6).hex()}",
            password_hash="x" * 20,
        )
        self.session.add(self.user)
        self.session.commit()
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

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    async def _seed_plan(self, phase_count: int = 4) -> Plan:
        def generator(fields, used_docs, context_text, instruction):
            return _plan_structure(phase_count)

        result = await generate_plan(
            self.session, self.user.id, _complete_payload(), [], generator
        )
        return self.session.scalar(select(Plan).where(Plan.id == result.plan_id))

    async def test_regenerate_archives_done_tasks_and_first_generate_does_not(self) -> None:
        plan = await self._seed_plan(phase_count=2)
        self.assertEqual(
            planner_service.list_plan_revisions(self.session, self.user.id, plan.id),
            [],
        )
        task = self.session.scalar(
            select(DailyTask).where(DailyTask.plan_id == plan.id)
        )
        task.status = "done"
        self.session.commit()
        done_text = task.description

        def generator(fields, used_docs, context_text, instruction):
            return _plan_structure(2)

        await planner_service.regenerate_plan(
            self.session,
            self.user.id,
            plan.id,
            "重排",
            None,
            [],
            generator,
        )
        rows = planner_service.list_plan_revisions(
            self.session, self.user.id, plan.id
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].reason, "regenerate")
        full = planner_service.get_plan_revision(
            self.session, self.user.id, plan.id, rows[0].id
        )
        snapshot = json.loads(full.snapshot)
        self.assertTrue(
            any(
                item["status"] == "done" and item["description"] == done_text
                for item in snapshot["dailyTasks"]
            )
        )
        live = list(
            self.session.scalars(
                select(DailyTask).where(DailyTask.plan_id == plan.id)
            )
        )
        self.assertTrue(live)
        self.assertTrue(all(item.status == "pending" for item in live))
        from app.routers.plans import _revision_summary

        self.assertNotIn("snapshot", _revision_summary(rows[0]))

    async def test_regenerate_keeps_plan_id_and_rebuilds_children(self) -> None:
        plan = await self._seed_plan(phase_count=4)
        plan_id = plan.id
        old_phase_ids = set(
            self.session.scalars(select(Phase.id).where(Phase.plan_id == plan_id))
        )

        captured: dict = {}

        def generator(fields, used_docs, context_text, instruction):
            captured["instruction"] = instruction
            return _plan_structure(2)

        result = await planner_service.regenerate_plan(
            self.session,
            self.user.id,
            plan_id,
            "压缩成两阶段",
            {"dailyMinutes": 300},
            [],
            generator,
        )

        self.assertEqual(result.plan_id, plan_id)
        self.assertEqual(result.phases, 2)
        self.assertEqual(captured["instruction"], "压缩成两阶段")

        self.session.expire_all()
        refreshed = self.session.scalar(select(Plan).where(Plan.id == plan_id))
        self.assertEqual(refreshed.total_phases, 2)
        self.assertEqual(refreshed.daily_minutes, 300)
        # Unspecified fields survive a vague edit request.
        self.assertEqual(refreshed.goal_name, "考研数学")
        self.assertEqual(refreshed.goal_date, date(2025, 12, 21))
        self.assertEqual(refreshed.current_level, "零基础")

        new_phases = list(
            self.session.scalars(
                select(Phase).where(Phase.plan_id == plan_id).order_by(Phase.phase_index)
            )
        )
        self.assertEqual([p.phase_index for p in new_phases], [1, 2])
        # Children were rebuilt, not reused.
        self.assertFalse(old_phase_ids & {p.id for p in new_phases})

    async def test_regenerate_unknown_plan_raises_not_found(self) -> None:
        def generator(fields, used_docs, context_text, instruction):
            return _plan_structure(2)

        with self.assertRaises(planner_service.PlanNotFoundError):
            await planner_service.regenerate_plan(
                self.session, self.user.id, uuid.uuid4(), "x", {}, [], generator
            )

    async def test_regenerate_another_users_plan_raises_not_found(self) -> None:
        plan = await self._seed_plan(phase_count=2)
        other = User(
            username=f"other-{os.urandom(6).hex()}",
            password_hash="x" * 20,
        )
        self.session.add(other)
        self.session.flush()
        # Give the other user their own verified config so the ownership check —
        # not the NO_API_KEY guard — is what rejects the request.
        self.session.add(
            ApiConfig(
                user_id=other.id,
                api_key_cipher="cipher",
                model_type="gpt",
                base_url="https://example.com",
                is_verified=True,
            )
        )
        self.session.commit()

        def generator(fields, used_docs, context_text, instruction):
            return _plan_structure(2)

        with self.assertRaises(planner_service.PlanNotFoundError):
            await planner_service.regenerate_plan(
                self.session, other.id, plan.id, "x", {}, [], generator
            )

    async def test_regenerate_invalid_structure_preserves_old_plan(self) -> None:
        plan = await self._seed_plan(phase_count=4)
        plan_id = plan.id

        def generator(fields, used_docs, context_text, instruction):
            return _plan_structure(1)  # below MIN_PHASES

        with self.assertRaises(PlanGenerationError):
            await planner_service.regenerate_plan(
                self.session, self.user.id, plan_id, "x", {}, [], generator
            )
        self.session.rollback()

        self.session.expire_all()
        refreshed = self.session.scalar(select(Plan).where(Plan.id == plan_id))
        self.assertEqual(refreshed.total_phases, 4)
        phases = list(
            self.session.scalars(select(Phase).where(Phase.plan_id == plan_id))
        )
        self.assertEqual(len(phases), 4)


class UpdatePhaseTests(unittest.TestCase):
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
        self.user = User(
            username=f"phase-{os.urandom(6).hex()}",
            password_hash="x" * 20,
        )
        self.session.add(self.user)
        self.session.flush()
        self.plan = Plan(
            user_id=self.user.id,
            goal_name="考研数学",
            start_date=date(2025, 1, 1),
            goal_date=date(2025, 12, 21),
            current_level="零基础",
            daily_minutes=120,
            total_phases=2,
        )
        self.session.add(self.plan)
        self.session.flush()
        self.phase_one = Phase(
            plan_id=self.plan.id,
            phase_index=1,
            name="基础",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 2, 1),
            is_current=True,
        )
        self.phase_two = Phase(
            plan_id=self.plan.id,
            phase_index=2,
            name="强化",
            start_date=date(2025, 2, 1),
            end_date=date(2025, 4, 1),
        )
        self.session.add_all([self.phase_one, self.phase_two])
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def test_partial_update_leaves_omitted_fields_untouched(self) -> None:
        planner_service.update_phase(
            self.session, self.user.id, self.phase_one.id, {"name": "基础夯实"}
        )
        self.session.expire_all()
        phase = self.session.get(Phase, self.phase_one.id)
        self.assertEqual(phase.name, "基础夯实")
        self.assertEqual(phase.start_date, date(2025, 1, 1))
        self.assertEqual(phase.end_date, date(2025, 2, 1))
        self.assertTrue(phase.is_current)

    def test_explicit_none_is_not_a_wipe(self) -> None:
        planner_service.update_phase(
            self.session,
            self.user.id,
            self.phase_one.id,
            {"name": None, "start_date": None, "end_date": None},
        )
        self.session.expire_all()
        phase = self.session.get(Phase, self.phase_one.id)
        self.assertEqual(phase.name, "基础")
        self.assertEqual(phase.start_date, date(2025, 1, 1))
        self.assertEqual(phase.end_date, date(2025, 2, 1))

    def test_unknown_phase_raises_not_found(self) -> None:
        with self.assertRaises(planner_service.PhaseNotFoundError):
            planner_service.update_phase(
                self.session, self.user.id, uuid.uuid4(), {"name": "x"}
            )

    def test_another_users_phase_raises_not_found(self) -> None:
        other = User(username=f"o-{os.urandom(6).hex()}", password_hash="x" * 20)
        self.session.add(other)
        self.session.commit()
        with self.assertRaises(planner_service.PhaseNotFoundError):
            planner_service.update_phase(
                self.session, other.id, self.phase_one.id, {"name": "篡改"}
            )


if __name__ == "__main__":
    unittest.main()
