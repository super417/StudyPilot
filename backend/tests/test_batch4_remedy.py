"""Batch 4 remedy: overdue work becomes a confirmable choice, not an automatic dump onto today."""

import base64
import os
import tempfile
import unittest
import uuid
from datetime import timedelta
from unittest.mock import patch

from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.sql.dml import Update

from app.core.clock import local_today
from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import CheckIn, DailyTask, Phase, Plan, PlanAdjustment, PracticeQuestion, User
from app.services import adjustment_service, remedy_service, task_service
from app.services.adjustment_service import AdjustmentConflictError


class RemedyTests(unittest.TestCase):
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
        self.today = local_today()

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _user(self) -> User:
        user = User(username=f"remedy-{os.urandom(4).hex()}", password_hash="x")
        self.session.add(user)
        self.session.commit()
        return user

    def _plan(
        self,
        user: User,
        *,
        daily_minutes: int = 60,
        goal_offset: int = 1,
        phase_end_offset: int = -1,
    ) -> tuple[Plan, Phase]:
        plan = Plan(
            user_id=user.id,
            goal_name="补救",
            start_date=self.today - timedelta(days=10),
            goal_date=self.today + timedelta(days=goal_offset),
            current_level="入门",
            daily_minutes=daily_minutes,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        phase = Phase(
            plan_id=plan.id,
            phase_index=0,
            name="已过期阶段",
            start_date=plan.start_date,
            end_date=self.today + timedelta(days=phase_end_offset),
            is_current=True,
        )
        self.session.add(phase)
        self.session.commit()
        return plan, phase

    def _task(
        self,
        plan: Plan,
        phase: Phase,
        offset: int,
        description: str,
        minutes: int | None,
        status: str = "pending",
    ) -> DailyTask:
        day = self.today + timedelta(days=offset)
        task = DailyTask(
            plan_id=plan.id,
            phase_id=phase.id,
            task_date=day,
            week_label=f"W{day.isocalendar().week:02d}",
            description=description,
            status=status,
            estimated_minutes=minutes,
        )
        self.session.add(task)
        self.session.commit()
        return task

    def _check_in(self, user: User, minutes: int, note: str = "很难") -> CheckIn:
        row = CheckIn(
            user_id=user.id,
            check_date=self.today,
            duration_minutes=minutes,
            difficulty=4,
            energy=2,
            note=note,
        )
        self.session.add(row)
        self.session.commit()
        return row

    def test_get_daily_tasks_does_not_write_carry(self) -> None:
        user = self._user()
        plan, phase = self._plan(user)
        overdue = self._task(plan, phase, -1, "昨天没标完成", 30)
        before = self.session.scalar(select(func.count()).select_from(DailyTask))
        task_service.get_daily_tasks(self.session, user.id, self.today)
        task_service.get_phase_tasks(self.session, user.id, phase.id)
        self.session.expire_all()
        self.assertEqual(self.session.get(DailyTask, overdue.id).status, "pending")
        self.assertEqual(self.session.get(DailyTask, overdue.id).task_date, overdue.task_date)
        self.assertEqual(
            self.session.scalar(select(func.count()).select_from(DailyTask)),
            before,
        )

    def test_extend_one_day_when_old_goal_is_full_and_phase_has_ended(self) -> None:
        user = self._user()
        plan, phase = self._plan(user, daily_minutes=60, goal_offset=1, phase_end_offset=-1)
        future = self._task(plan, phase, 1, "明天已排满", 60)
        overdue = self._task(plan, phase, -1, "待补的过期任务", 30)
        original_goal = plan.goal_date
        phase_end = phase.end_date
        overdue_status = overdue.status
        future_status = future.status
        preview = remedy_service.create_remedy_preview(self.session, user.id, plan.id)
        remedy = preview.diff["remedy"]
        spread = next(item for item in remedy["options"] if item["id"] == "spread")
        extend = next(item for item in remedy["options"] if item["id"] == "extend")
        self.assertFalse(spread["ok"])
        self.assertTrue(extend["ok"])
        self.assertEqual(preview.steps[1]["model"], "not_called")
        self.assertIsNone(remedy["recordedMinutes"])
        revised = remedy_service.revise_remedy(
            self.session,
            user.id,
            plan.id,
            preview.id,
            option_id="extend",
            keep_source_ids=[str(overdue.id)],
            minute_overrides=None,
            selection_version=preview.proposal["selectionVersion"],
        )
        self.assertTrue(revised.validation["ok"])
        placed = revised.diff["remedy"]["arranged"][0]
        self.assertEqual(placed["taskDate"], (self.today + timedelta(days=2)).isoformat())
        self.assertEqual(placed["phaseEnd"], phase_end.isoformat())
        change = next(item for item in revised.diff["planChanges"] if item["field"] == "goalDate")
        self.assertEqual(change["after"], placed["taskDate"])
        self.session.expire_all()
        self.assertEqual(self.session.get(Plan, plan.id).goal_date, plan.goal_date)
        self.assertEqual(self.session.get(DailyTask, overdue.id).status, "pending")

        confirmed = remedy_service.confirm_remedy(
            self.session,
            user.id,
            plan.id,
            revised.id,
            expected_selection_version=revised.proposal["selectionVersion"],
        )
        self.assertEqual(confirmed.status, "confirmed")
        self.session.expire_all()
        source = self.session.get(DailyTask, overdue.id)
        kept = self.session.get(DailyTask, future.id)
        live_phase = self.session.get(Phase, phase.id)
        live_plan = self.session.get(Plan, plan.id)
        copies = list(
            self.session.scalars(
                select(DailyTask).where(DailyTask.carried_from_id == overdue.id)
            )
        )
        self.assertEqual(source.status, "carried")
        self.assertEqual(source.task_date, overdue.task_date)
        self.assertEqual(source.estimated_minutes, 30)
        self.assertEqual(len(copies), 1)
        self.assertEqual(copies[0].status, "pending")
        self.assertEqual(copies[0].phase_id, phase.id)
        self.assertEqual(copies[0].task_date.isoformat(), placed["taskDate"])
        self.assertEqual(copies[0].description, overdue.description)
        self.assertEqual(kept.id, future.id)
        self.assertEqual(kept.task_date, future.task_date)
        self.assertEqual(kept.description, future.description)
        self.assertEqual(live_phase.end_date, phase_end)
        self.assertEqual(kept.status, future_status)
        self.assertEqual(live_plan.goal_date.isoformat(), placed["taskDate"])
        self.assertEqual(
            self.session.scalar(
                select(func.count()).select_from(Phase).where(Phase.plan_id == plan.id)
            ),
            1,
        )

        undone = remedy_service.undo_remedy(self.session, user.id, plan.id)
        self.assertEqual(undone.status, "undone")
        self.session.expire_all()
        self.assertEqual(self.session.get(DailyTask, overdue.id).status, "pending")
        self.assertEqual(self.session.get(DailyTask, overdue.id).status, overdue_status)
        self.assertEqual(self.session.get(DailyTask, future.id).status, future_status)
        self.assertEqual(self.session.get(Phase, phase.id).end_date, phase_end)
        self.assertEqual(self.session.get(Plan, plan.id).goal_date, original_goal)
        self.assertEqual(
            list(
                self.session.scalars(
                    select(DailyTask).where(DailyTask.carried_from_id == overdue.id)
                )
            ),
            [],
        )

    def test_second_preview_cannot_copy_the_same_source(self) -> None:
        user = self._user()
        plan, phase = self._plan(user, goal_offset=3, phase_end_offset=-1)
        overdue = self._task(plan, phase, -1, "只补一次", 20)
        first = remedy_service.create_remedy_preview(self.session, user.id, plan.id)
        second = remedy_service.create_remedy_preview(self.session, user.id, plan.id)
        remedy_service.confirm_remedy(
            self.session,
            user.id,
            plan.id,
            first.id,
            expected_selection_version=first.proposal["selectionVersion"],
        )
        with self.assertRaises(AdjustmentConflictError):
            remedy_service.confirm_remedy(
                self.session,
                user.id,
                plan.id,
                second.id,
                expected_selection_version=second.proposal["selectionVersion"],
            )
        self.session.expire_all()
        self.assertEqual(
            len(
                list(
                    self.session.scalars(
                        select(DailyTask).where(DailyTask.carried_from_id == overdue.id)
                    )
                )
            ),
            1,
        )
        self.assertEqual(self.session.get(PlanAdjustment, second.id).status, "conflict")

    def test_new_check_in_blocks_old_capacity(self) -> None:
        user = self._user()
        plan, phase = self._plan(user, goal_offset=3)
        overdue = self._task(plan, phase, -1, "依据会变", 20)
        preview = remedy_service.create_remedy_preview(self.session, user.id, plan.id)
        self._check_in(user, 30)
        with self.assertRaises(AdjustmentConflictError):
            remedy_service.confirm_remedy(
                self.session,
                user.id,
                plan.id,
                preview.id,
                expected_selection_version=preview.proposal["selectionVersion"],
            )
        self.session.expire_all()
        self.assertEqual(self.session.get(DailyTask, overdue.id).status, "pending")
        self.assertEqual(
            list(
                self.session.scalars(
                    select(DailyTask).where(DailyTask.carried_from_id == overdue.id)
                )
            ),
            [],
        )

    def test_unknown_oversize_over_limit_and_skip_once(self) -> None:
        user = self._user()
        plan, phase = self._plan(user, daily_minutes=60, goal_offset=3)
        unknown = self._task(plan, phase, -1, "分钟未知", None)
        huge = self._task(plan, phase, -2, "超过一天", 90)
        preview = remedy_service.create_remedy_preview(self.session, user.id, plan.id)
        self.assertIsNone(preview.diff["remedy"]["recordedMinutes"])
        self.assertIsNone(preview.diff["remedy"]["todayAvailable"])
        self.assertFalse(preview.validation["ok"])
        with self.assertRaises(AdjustmentConflictError):
            remedy_service.confirm_remedy(
                self.session,
                user.id,
                plan.id,
                preview.id,
                expected_selection_version=preview.proposal["selectionVersion"],
            )
        self._check_in(user, 90, note="今天超时")
        blocked = remedy_service.create_remedy_preview(self.session, user.id, plan.id)
        self.assertTrue(blocked.diff["remedy"]["overLimit"])
        self.assertEqual(blocked.diff["remedy"]["todayAvailable"], 0)
        self.assertEqual(blocked.diff["remedy"]["recordedMinutes"], 90)
        self.assertIn("今天超时", str(blocked.evidence_refs))
        dates = [item["taskDate"] for item in blocked.diff["remedy"]["arranged"]]
        self.assertNotIn(self.today.isoformat(), dates)
        revised = remedy_service.revise_remedy(
            self.session,
            user.id,
            plan.id,
            blocked.id,
            option_id="reduce",
            keep_source_ids=[],
            minute_overrides={str(unknown.id): 30},
            selection_version=blocked.proposal["selectionVersion"],
        )
        self.assertTrue(revised.validation["ok"])
        self.assertEqual(revised.diff["remedy"]["arranged"], [])
        reasons = {item["sourceId"]: item["reason"] for item in revised.diff["remedy"]["notArranged"]}
        self.assertEqual(reasons[str(unknown.id)], "本次不补做")
        self.assertEqual(reasons[str(huge.id)], "本次不补做")
        self.session.expire_all()
        self.assertIsNone(self.session.get(DailyTask, unknown.id).estimated_minutes)
        confirmed = remedy_service.confirm_remedy(
            self.session,
            user.id,
            plan.id,
            revised.id,
            expected_selection_version=revised.proposal["selectionVersion"],
        )
        self.assertEqual(confirmed.status, "confirmed")
        self.session.expire_all()
        self.assertEqual(self.session.get(DailyTask, unknown.id).status, "pending")
        self.assertEqual(self.session.get(DailyTask, huge.id).status, "pending")
        self.assertEqual(
            self.session.scalar(select(func.count()).select_from(DailyTask)),
            2,
        )

    def test_done_or_answered_copy_blocks_undo_and_check_in_stays(self) -> None:
        user = self._user()
        plan, phase = self._plan(user, goal_offset=3)
        overdue = self._task(plan, phase, -1, "补完再完成", 20)
        done = self._task(plan, phase, -3, "已经做完", 20, status="done")
        check_in = self._check_in(user, 15)
        preview = remedy_service.create_remedy_preview(self.session, user.id, plan.id)
        self.assertEqual(preview.diff["remedy"]["doneCount"], 1)
        self.assertEqual(preview.diff["remedy"]["recordedMinutes"], 15)
        remedy_service.confirm_remedy(
            self.session,
            user.id,
            plan.id,
            preview.id,
            expected_selection_version=preview.proposal["selectionVersion"],
        )
        copy = self.session.scalar(
            select(DailyTask).where(DailyTask.carried_from_id == overdue.id)
        )
        assert copy is not None
        copy.status = "done"
        self.session.add(
            PracticeQuestion(
                user_id=user.id,
                source="uploaded",
                subject="补救",
                question="题",
                answer="答",
                explanation="",
                source_task_id=copy.id,
                status="wrong",
            )
        )
        self.session.commit()
        with self.assertRaises(AdjustmentConflictError):
            remedy_service.undo_remedy(self.session, user.id, plan.id)
        self.session.expire_all()
        self.assertEqual(self.session.get(DailyTask, copy.id).status, "done")
        self.assertEqual(self.session.get(DailyTask, overdue.id).status, "carried")
        self.assertEqual(self.session.get(DailyTask, done.id).status, "done")
        self.assertIsNotNone(self.session.get(CheckIn, check_in.id))
        self.assertEqual(
            self.session.scalar(
                select(func.count()).select_from(PracticeQuestion)
            ),
            1,
        )

    def _confirm(self, user: User, plan: Plan, preview: PlanAdjustment) -> PlanAdjustment:
        return adjustment_service.confirm_adjustment(
            self.session,
            user.id,
            plan.id,
            preview.id,
            expected_selection_version=preview.proposal["selectionVersion"],
        )

    def test_k2_later_progress_and_deadline_survive_undo(self) -> None:
        user = self._user()
        plan, phase = self._plan(user, goal_offset=3)
        self._task(plan, phase, -1, "过期", 20)
        retained = self._task(plan, phase, 1, "后来完成的任务", 20)
        preview = remedy_service.create_remedy_preview(self.session, user.id, plan.id)
        self._confirm(user, plan, preview)
        task_service.set_task_status(self.session, user.id, retained.id, "done")
        self.session.expire_all()
        status_before_undo = self.session.get(DailyTask, retained.id).status
        self.assertEqual(status_before_undo, "done")
        later_goal = plan.goal_date + timedelta(days=4)
        plan.goal_date = later_goal
        self.session.commit()
        try:
            adjustment_service.undo_latest(self.session, user.id, plan.id)
        except AdjustmentConflictError:
            self.session.rollback()
        self.session.expire_all()
        self.assertEqual(self.session.get(DailyTask, retained.id).status, "done")
        self.assertEqual(
            self.session.get(DailyTask, retained.id).status, status_before_undo
        )
        self.assertEqual(self.session.get(Plan, plan.id).goal_date, later_goal)

    def test_k3_edited_or_past_copy_blocks_undo(self) -> None:
        user = self._user()
        plan, phase = self._plan(user, goal_offset=3)
        source = self._task(plan, phase, -1, "过期", 20)
        source.resource_url = "https://example.com/lesson"
        self.session.commit()
        preview = remedy_service.create_remedy_preview(self.session, user.id, plan.id)
        self._confirm(user, plan, preview)
        copied = self.session.scalar(
            select(DailyTask).where(DailyTask.carried_from_id == source.id)
        )
        assert copied is not None
        copied.description = "后来改过的副本"
        copied.estimated_minutes = 35
        self.session.commit()
        with self.assertRaises(AdjustmentConflictError):
            adjustment_service.undo_latest(self.session, user.id, plan.id)
        self.session.expire_all()
        self.assertEqual(self.session.get(DailyTask, copied.id).description, "后来改过的副本")
        self.assertEqual(self.session.get(DailyTask, source.id).status, "carried")
        self.assertEqual(self.session.get(DailyTask, source.id).resource_url, source.resource_url)

        fresh_user = self._user()
        fresh_plan, fresh_phase = self._plan(fresh_user, goal_offset=3)
        fresh_source = self._task(fresh_plan, fresh_phase, -1, "跨日副本", 20)
        fresh_preview = remedy_service.create_remedy_preview(
            self.session, fresh_user.id, fresh_plan.id
        )
        self._confirm(fresh_user, fresh_plan, fresh_preview)
        fresh_copy = self.session.scalar(
            select(DailyTask).where(DailyTask.carried_from_id == fresh_source.id)
        )
        assert fresh_copy is not None
        with patch.object(
            remedy_service, "local_today", return_value=fresh_copy.task_date + timedelta(days=1)
        ):
            with self.assertRaises(AdjustmentConflictError):
                adjustment_service.undo_latest(self.session, fresh_user.id, fresh_plan.id)
        self.assertIsNotNone(self.session.get(DailyTask, fresh_copy.id))

    def test_k5_saved_minutes_stay_on_preview(self) -> None:
        user = self._user()
        plan, phase = self._plan(user, goal_offset=3)
        unknown = self._task(plan, phase, -1, "分钟未知", None)
        preview = remedy_service.create_remedy_preview(self.session, user.id, plan.id)
        self.assertFalse(preview.validation["ok"])
        seen_version = preview.proposal["selectionVersion"]
        revised = remedy_service.revise_remedy(
            self.session,
            user.id,
            plan.id,
            preview.id,
            option_id="spread",
            keep_source_ids=[str(unknown.id)],
            minute_overrides={str(unknown.id): 25},
            selection_version=preview.proposal["selectionVersion"],
        )
        shown = next(
            item
            for item in revised.diff["remedy"]["candidates"]
            if item["sourceId"] == str(unknown.id)
        )
        self.assertEqual(shown["estimatedMinutes"], 25)
        self.assertEqual(revised.proposal["savedMinutes"][str(unknown.id)], 25)
        self.assertEqual(
            revised.proposal["selectionVersion"],
            seen_version + 1,
        )
        self.assertTrue(revised.validation["ok"])
        self.session.expire_all()
        self.assertIsNone(self.session.get(DailyTask, unknown.id).estimated_minutes)

    def test_k6_retained_unknown_or_overload_is_not_a_pass(self) -> None:
        user = self._user()
        plan, phase = self._plan(user, daily_minutes=60, goal_offset=3)
        self._task(plan, phase, -1, "过期", 20)
        unknown_future = self._task(plan, phase, 1, "明天分钟未知", None)
        preview = remedy_service.create_remedy_preview(self.session, user.id, plan.id)
        self.assertFalse(preview.validation["ok"])
        self.assertNotEqual(preview.validation["checks"].get("capacity"), "pass")
        unknown_day = next(
            item
            for item in preview.validation["durationDays"]
            if item["date"] == unknown_future.task_date.isoformat()
        )
        self.assertGreater(unknown_day["unknownCount"], 0)
        self.assertEqual(unknown_day["result"], "unknown")
        self.assertEqual(self.session.get(DailyTask, unknown_future.id).estimated_minutes, None)

        user = self._user()
        plan, phase = self._plan(user, daily_minutes=60, goal_offset=3)
        self._task(plan, phase, -1, "过期", 20)
        overloaded = self._task(plan, phase, 1, "明天已超限", 90)
        preview = remedy_service.create_remedy_preview(self.session, user.id, plan.id)
        self.assertFalse(preview.validation["ok"])
        self.assertEqual(preview.validation["checks"]["capacity"], "fail")
        day = next(
            item
            for item in preview.validation["durationDays"]
            if item["date"] == overloaded.task_date.isoformat()
        )
        self.assertEqual(day["knownMinutes"], 90)
        self.assertEqual(day["cap"], 60)
        self.assertEqual(day["result"], "fail")
        self.assertEqual(self.session.get(DailyTask, overloaded.id).description, "明天已超限")

    def test_k7_evidence_names_the_action_and_code_step(self) -> None:
        user = self._user()
        plan, phase = self._plan(user, goal_offset=3)
        source = self._task(plan, phase, -1, "过期", 20)
        self._check_in(user, 15, note="review-difficulty-note")
        preview = remedy_service.create_remedy_preview(self.session, user.id, plan.id)
        task_ref = next(item for item in preview.evidence_refs if item["kind"] == "task")
        checkin_ref = next(item for item in preview.evidence_refs if item["kind"] == "checkin")
        self.assertEqual(task_ref["actionId"], str(source.id))
        self.assertNotIn("actionId", checkin_ref)
        self.assertEqual(checkin_ref["note"], "review-difficulty-note")
        self.assertEqual(preview.steps[1]["method"], "code")
        self.assertEqual(preview.steps[1]["model"], "not_called")
        self.assertFalse(preview.steps[1]["mock"])
        self.assertEqual(preview.diff["remedy"]["dailyMinutes"], 60)
        self.assertTrue(preview.validation["durationDays"])

    def test_undo_restores_progress_computed_from_tasks(self) -> None:
        user = self._user()
        plan, phase = self._plan(
            user, daily_minutes=60, goal_offset=1, phase_end_offset=-1
        )
        done = self._task(plan, phase, 1, "已经做完", 60, status="done")
        overdue = self._task(plan, phase, -1, "待补的过期任务", 30)
        before = task_service.phase_progress(self.session, phase.id)
        preview = remedy_service.create_remedy_preview(self.session, user.id, plan.id)
        revised = remedy_service.revise_remedy(
            self.session,
            user.id,
            plan.id,
            preview.id,
            option_id="extend",
            keep_source_ids=[str(overdue.id)],
            minute_overrides=None,
            selection_version=preview.proposal["selectionVersion"],
        )
        remedy_service.confirm_remedy(
            self.session,
            user.id,
            plan.id,
            revised.id,
            expected_selection_version=revised.proposal["selectionVersion"],
        )
        undone = remedy_service.undo_remedy(self.session, user.id, plan.id)
        self.assertEqual(undone.status, "undone")
        self.session.expire_all()
        self.assertEqual(self.session.get(DailyTask, overdue.id).status, "pending")
        self.assertEqual(self.session.get(DailyTask, done.id).status, "done")
        self.assertEqual(task_service.phase_progress(self.session, phase.id), before)


class RemedyFileTests(RemedyTests):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="studypilot-batch4-k4-")
        self.engine = create_engine(
            "sqlite:///" + self.temp.name.replace("\\", "/") + "/review.db",
            connect_args={"check_same_thread": False, "timeout": 0.1},
        )
        self.session_factory = sessionmaker(
            bind=self.engine, class_=Session, expire_on_commit=False
        )
        super().setUp()

    def tearDown(self) -> None:
        super().tearDown()
        self.engine.dispose()
        self.temp.cleanup()

    def test_k4_live_cap_changed_before_claim_cannot_confirm(self) -> None:
        user = self._user()
        plan, phase = self._plan(user, goal_offset=3)
        source = self._task(plan, phase, -1, "过期", 20)
        preview = remedy_service.create_remedy_preview(self.session, user.id, plan.id)
        ids = (user.id, plan.id, source.id, preview.id)
        version = preview.proposal["selectionVersion"]
        interleaved = []

        def before_claim(state):
            if (
                interleaved
                or not isinstance(state.statement, Update)
                or state.statement.table.name != "plan_adjustments"
            ):
                return
            interleaved.append(True)
            with self.session_factory() as other:
                live = other.get(Plan, ids[1])
                live.daily_minutes = 40
                other.commit()

        event.listen(self.session, "do_orm_execute", before_claim)
        conflicted = False
        try:
            adjustment_service.confirm_adjustment(
                self.session,
                ids[0],
                ids[1],
                ids[3],
                expected_selection_version=version,
            )
        except AdjustmentConflictError:
            conflicted = True
        finally:
            event.remove(self.session, "do_orm_execute", before_claim)
        self.assertEqual(interleaved, [True])
        self.session.expire_all()
        self.assertTrue(conflicted)
        self.assertEqual(self.session.get(DailyTask, ids[2]).status, "pending")
        self.assertEqual(self.session.get(Plan, ids[1]).daily_minutes, 40)
        self.assertEqual(
            list(
                self.session.scalars(
                    select(DailyTask).where(DailyTask.carried_from_id == ids[2])
                )
            ),
            [],
        )
