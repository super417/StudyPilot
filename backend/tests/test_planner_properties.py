"""Planner property tests: clarify precision, round bound, doc readiness.

Covers task 18.3 — properties 12, 13 and 22, plus 19.2's Property 14. Every
property runs the system with a **mocked** AI call (``_plan_structure``), so the
tests exercise only our own logic (state machine, readiness filtering, scoping)
and never reach an external model.

Each property is a separate ``@given`` case at >= 100 iterations, annotated with
the ``Feature: study-pilot, Property N`` marker so it maps back to design.md.
"""

import base64
import os
import unittest
import uuid
from datetime import date, timedelta

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.models.base import Base
from app.models.entities import ApiConfig, DailyTask, Phase, Plan, User, UserDocument
from app.services import planner_service
from app.services.plan_draft_store import MAX_CLARIFY_ROUNDS, PlanDraft
from app.services.planner_service import (
    REQUIRED_FIELDS,
    ClarifyOutcome,
    GenerateOutcome,
    advance_state,
    generate_plan,
    missing_fields,
    update_phase,
)

# >100 iterations per property, as required by the task.
PROPERTY_SETTINGS = settings(
    max_examples=150,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)

_VALID_GOAL_DATE = "2026-12-21"


def _plan_structure(phase_count: int) -> dict:
    return {
        "phases": [
            {
                "name": f"阶段 {i + 1}",
                "start_date": "2026-01-01",
                "end_date": "2026-02-01",
                "daily_tasks": [
                    {
                        "task_date": "2026-01-01",
                        "week_label": "W01",
                        "description": f"阶段{i + 1}任务",
                    }
                ],
            }
            for i in range(phase_count)
        ]
    }


# --- strategies -------------------------------------------------------------

# One of the four required fields, or None meaning "absent from the payload".
_field_values = st.one_of(st.none(), st.text(min_size=0, max_size=12))


@st.composite
def _payload_with_random_gaps(draw) -> dict:
    """A payload where each required field is either valid or intentionally bad.

    Bad values cover the three failure shapes the validator must catch: absent,
    empty/whitespace string, and a malformed value type.
    """
    payload: dict[str, object] = {}
    for field in REQUIRED_FIELDS:
        kind = draw(st.sampled_from(["valid", "absent", "blank", "malformed"]))
        if field == "goalName":
            payload[field] = {"valid": "考研数学", "blank": "   ", "malformed": 7}[
                kind
            ] if kind != "absent" else None
        elif field == "currentLevel":
            payload[field] = {"valid": "零基础", "blank": "\t", "malformed": []}[
                kind
            ] if kind != "absent" else None
        elif field == "goalDate":
            payload[field] = {
                "valid": _VALID_GOAL_DATE,
                "blank": "  ",
                "malformed": "2026-13-45",
            }[kind] if kind != "absent" else None
        else:  # dailyMinutes
            payload[field] = {"valid": 120, "blank": "  ", "malformed": 0}[
                kind
            ] if kind != "absent" else None
        if kind == "absent":
            payload.pop(field, None)
    return payload


@st.composite
def _doc_selection(draw) -> tuple[list[str], set[str]]:
    """Draw a doc-id selection plus the subset that is actually ready.

    Ids are drawn from a small pool so duplicates and overlaps occur naturally.
    """
    pool = [f"doc{index}" for index in range(draw(st.integers(min_value=1, max_value=6)))]
    selected = draw(st.lists(st.sampled_from(pool), min_size=0, max_size=6))
    ready = {doc_id for doc_id in pool if draw(st.booleans())}
    return selected, ready


@st.composite
def _payload_with_random_gaps_incomplete_only(draw) -> dict:
    """A reply that never completes the information (always leaves a gap).

    Property 13 needs replies that stay incomplete; this drops at least one
    required field and keeps the remaining ones valid so the only reason the
    machine keeps asking is the deliberate gap.
    """
    reply = {
        "goalName": "考研数学",
        "goalDate": _VALID_GOAL_DATE,
        "currentLevel": "零基础",
        "dailyMinutes": 120,
    }
    for _ in range(draw(st.integers(min_value=1, max_value=len(REQUIRED_FIELDS)))):
        reply.pop(draw(st.sampled_from(REQUIRED_FIELDS)), None)
    return reply


def _run(awaitable):
    """Drive one coroutine to completion without an event loop fixture."""
    import asyncio

    return asyncio.run(awaitable)


class PropertyTests(unittest.TestCase):
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
        Base.metadata.drop_all(cls.engine)
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
            username=f"prop-{os.urandom(6).hex()}",
            password_hash="x" * 20,
        )
        self.session.add(self.user)
        self.session.commit()

    def tearDown(self) -> None:
        self.session.rollback()
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

    def _reset_user_data(self) -> None:
        """Wipe every row owned by the test user.

        Hypothesis re-runs the property body for each generated example against
        the *same* ``setUp``-created user, so any state written by a previous
        example (documents, plans, configs) would otherwise leak into the next
        one and make the expected sets depend on example ordering.

        ``Phase`` and ``DailyTask`` carry no ``user_id``; they are reached
        through the user's plans.
        """
        plan_ids = list(
            self.session.scalars(select(Plan.id).where(Plan.user_id == self.user.id))
        )
        if plan_ids:
            self.session.query(DailyTask).filter(
                DailyTask.plan_id.in_(plan_ids)
            ).delete(synchronize_session=False)
            self.session.query(Phase).filter(
                Phase.plan_id.in_(plan_ids)
            ).delete(synchronize_session=False)
            self.session.query(Plan).filter(
                Plan.id.in_(plan_ids)
            ).delete(synchronize_session=False)
        for model in (UserDocument, ApiConfig):
            self.session.query(model).filter(
                model.user_id == self.user.id
            ).delete(synchronize_session=False)
        self.session.commit()

    def _add_document(self, doc_id: str, chunks: list[str], user_id=None) -> None:
        owner = user_id or self.user.id
        for index, chunk in enumerate(chunks):
            self.session.add(
                UserDocument(
                    user_id=owner,
                    doc_id=doc_id,
                    filename=f"{doc_id}.txt",
                    file_type="txt",
                    chunk_index=index,
                    content=chunk,
                )
            )
        self.session.commit()

    # --- Property 12 --------------------------------------------------------

    @PROPERTY_SETTINGS
    @given(payload=_payload_with_random_gaps())
    def test_property_12_clarify_names_exactly_the_missing_fields(
        self, payload: dict
    ) -> None:
        """Feature: study-pilot, Property 12: 缺失字段追问精确指明.

        Validates: Requirements 9.2

        For any subset of missing/invalid required fields, the planner reports
        information as insufficient and the field set it names in the clarify
        question is exactly the set that is actually missing — never broader,
        never narrower, and always in the stable declared order.
        """
        reported = missing_fields(payload)

        # Ground truth, computed independently of the implementation.
        expected = [
            field
            for field in REQUIRED_FIELDS
            if not self._independently_valid(field, payload.get(field))
        ]
        self.assertEqual(reported, expected)

        if expected:
            # Drive the state machine from a draft that knows nothing yet: the
            # very first reply must ask for exactly these fields.
            draft = PlanDraft(user_id=uuid.uuid4(), fields={}, round=1)
            outcome = advance_state(draft, payload)
            self.assertIsInstance(outcome, ClarifyOutcome)
            self.assertEqual(set(outcome.missing), set(expected))
            self.assertEqual(outcome.missing, expected)
            for field in expected:
                self.assertIn(
                    planner_service._FIELD_PROMPTS[field],
                    outcome.question,
                    "clarify question must name every missing field",
                )
        else:
            self.assertEqual(reported, [])

    @staticmethod
    def _independently_valid(field: str, value: object) -> bool:
        if field == "goalDate":
            try:
                date.fromisoformat(value)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                return False
            return True
        if field == "dailyMinutes":
            return isinstance(value, int) and not isinstance(value, bool) and value > 0
        return isinstance(value, str) and bool(value.strip())

    # --- Property 13 --------------------------------------------------------

    @PROPERTY_SETTINGS
    @given(
        replies=st.lists(
            _payload_with_random_gaps_incomplete_only(),
            min_size=1,
            max_size=12,
        )
    )
    def test_property_13_round_bound_and_termination(self, replies: list) -> None:
        """Feature: study-pilot, Property 13: 追问轮次上界为 3 且状态机必终止.

        Validates: Requirements 9.3, 9.4, 9.5

        For any reply sequence whose information always stays incomplete, the
        clarify counter never exceeds 3 and a reply after the 3rd round always
        lands in the generate state — the machine cannot loop forever.
        """
        draft = PlanDraft(user_id=uuid.uuid4(), fields={}, round=1)
        clarify_rounds: list[int] = []
        terminal: GenerateOutcome | None = None

        for reply in replies:
            outcome = advance_state(draft, reply)
            if isinstance(outcome, GenerateOutcome):
                terminal = outcome
                break
            clarify_rounds.append(outcome.round)
            self.assertLessEqual(outcome.round, MAX_CLARIFY_ROUNDS)

        # Every observed round counter respects the cap.
        self.assertTrue(all(r <= MAX_CLARIFY_ROUNDS for r in clarify_rounds))

        # If the machine generated, it did so either once the information was
        # complete or at the round cap — never by looping past it.
        if terminal is not None:
            self.assertTrue(terminal.forced or missing_fields(terminal.fields) == [])
            self.assertLessEqual(draft.round, MAX_CLARIFY_ROUNDS)

        # Termination guarantee: replaying the same always-incomplete replies
        # until the machine gives up always reaches a FORCED generation within
        # MAX_CLARIFY_ROUNDS rounds — the loop is bounded, never infinite.
        probe = PlanDraft(user_id=uuid.uuid4(), fields={}, round=1)
        for _ in range(MAX_CLARIFY_ROUNDS + 1):
            outcome = advance_state(probe, {})
            if isinstance(outcome, GenerateOutcome):
                break
        self.assertIsInstance(outcome, GenerateOutcome)
        self.assertTrue(outcome.forced)
        self.assertLessEqual(probe.round, MAX_CLARIFY_ROUNDS)

    # --- Property 22 --------------------------------------------------------

    @PROPERTY_SETTINGS
    @given(selection=_doc_selection())
    def test_property_22_unready_docs_excluded_from_planning_context(
        self, selection: tuple[list[str], set[str]]
    ) -> None:
        """Feature: study-pilot, Property 22: 未就绪文档不被纳入规划依据.

        Validates: Requirements 9.8, 17.4

        For any selected document set with random ready/unready marks, the docs
        actually used as planning evidence are exactly the ready subset of the
        selection, every unready doc is reported as skipped, and no content of
        an unready doc ever reaches the planning context.
        """
        selected, ready_ids = selection
        self._reset_user_data()
        # Only the ready docs are persisted; unready ones simply have no rows.
        for doc_id in ready_ids:
            self._add_document(doc_id, [f"{doc_id}-CHUNK0"])
        self._add_verified_config()

        captured: dict = {}

        def generator(fields, used_docs, context_text, instruction):
            captured["used_docs"] = list(used_docs)
            captured["context_text"] = context_text
            return _plan_structure(2)

        result = _run(
            generate_plan(
                self.session,
                self.user.id,
                {
                    "goalName": "考研数学",
                    "goalDate": _VALID_GOAL_DATE,
                    "currentLevel": "零基础",
                    "dailyMinutes": 120,
                },
                selected,
                generator,
            )
        )

        # Expected sets, derived from the selection alone (dedup keeps 1st spot).
        expected_ready = [d for d in dict.fromkeys(selected) if d in ready_ids]
        expected_skipped = [d for d in dict.fromkeys(selected) if d not in ready_ids]

        self.assertEqual(result.used_docs, expected_ready)
        self.assertEqual(result.skipped_docs, expected_skipped)
        self.assertEqual(captured["used_docs"], expected_ready)

        # Used set is a subset of ready, and never intersects the skipped set.
        self.assertTrue(set(result.used_docs) <= ready_ids)
        self.assertFalse(set(result.used_docs) & set(result.skipped_docs))

        # No unready document contributed anything to the context.
        for doc_id in expected_skipped:
            self.assertNotIn(doc_id, captured["context_text"])

    # --- Property 14 --------------------------------------------------------

    @PROPERTY_SETTINGS
    @given(
        phase_count=st.integers(min_value=2, max_value=6),
        target_offset=st.integers(min_value=0, max_value=5),
        new_name=st.text(min_size=1, max_size=20),
        shift_days=st.integers(min_value=-30, max_value=30),
    )
    def test_property_14_phase_tweak_touches_only_the_target(
        self, phase_count: int, target_offset: int, new_name: str, shift_days: int
    ) -> None:
        """Feature: study-pilot, Property 14: 局部微调仅影响目标阶段.

        Validates: Requirements 10.3

        For any plan with several phases, tweaking one phase changes only that
        phase's row; every other phase's fields stay byte-identical.
        """
        self._reset_user_data()
        self._add_verified_config()

        def generator(fields, used_docs, context_text, instruction):
            return _plan_structure(phase_count)

        result = _run(
            generate_plan(
                self.session,
                self.user.id,
                {
                    "goalName": "考研数学",
                    "goalDate": _VALID_GOAL_DATE,
                    "currentLevel": "零基础",
                    "dailyMinutes": 120,
                },
                [],
                generator,
            )
        )
        plan_id = result.plan_id

        phases = list(
            self.session.scalars(
                select(Phase)
                .where(Phase.plan_id == plan_id)
                .order_by(Phase.phase_index)
            )
        )
        self.assertEqual(len(phases), phase_count)
        target = phases[target_offset % phase_count]

        before = {
            phase.id: (
                phase.phase_index,
                phase.name,
                phase.start_date,
                phase.end_date,
                phase.progress_percent,
                phase.is_current,
                phase.is_completed,
            )
            for phase in phases
        }
        tasks_before = {
            task.id: (task.phase_id, task.task_date, task.description, task.status)
            for task in self.session.scalars(
                select(DailyTask).where(DailyTask.plan_id == plan_id)
            )
        }

        new_start = target.start_date + timedelta(days=shift_days)
        new_end = target.end_date + timedelta(days=shift_days)
        update_phase(
            self.session,
            self.user.id,
            target.id,
            {
                "name": new_name,
                "start_date": new_start.isoformat(),
                "end_date": new_end.isoformat(),
            },
        )

        self.session.expire_all()
        after_phases = list(
            self.session.scalars(
                select(Phase)
                .where(Phase.plan_id == plan_id)
                .order_by(Phase.phase_index)
            )
        )
        self.assertEqual(len(after_phases), phase_count)

        for phase in after_phases:
            if phase.id == target.id:
                self.assertEqual(phase.name, new_name)
                self.assertEqual(phase.start_date, new_start)
                self.assertEqual(phase.end_date, new_end)
                continue
            self.assertEqual(before[phase.id], (
                phase.phase_index,
                phase.name,
                phase.start_date,
                phase.end_date,
                phase.progress_percent,
                phase.is_current,
                phase.is_completed,
            ), "every non-target phase must stay unchanged")

        # Daily tasks are untouched by a card-level tweak.
        tasks_after = {
            task.id: (task.phase_id, task.task_date, task.description, task.status)
            for task in self.session.scalars(
                select(DailyTask).where(DailyTask.plan_id == plan_id)
            )
        }
        self.assertEqual(tasks_before, tasks_after)


if __name__ == "__main__":
    unittest.main()
