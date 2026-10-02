"""Planner: clarify state machine + plan generation, regeneration, and edits.

Scope:
- ``missing_fields`` — the pure required-field validator that drives clarify
  (task 18.1).
- The clarify state machine, bounded to 3 rounds (see ``plan_draft_store``).
- ``generate_plan`` — validate the AI-produced structure and persist Plan /
  Phases / Daily_Tasks in a single transaction (tasks 18.1/18.2). Document
  readiness retrieval feeds the planning context (task 18.2).
- ``regenerate_plan`` — conversation-driven re-generation that UPDATES the
  existing Plan row and rebuilds its child rows in place (task 19.1).
- ``update_phase`` — card-level manual tweak of a single Phase that leaves
  every other Phase byte-identical (task 19.1).
- ``format_plan_sse`` — SSE framing for the planner-specific event set
  (clarify / notice / done / error), kept separate from ``ai_proxy.format_sse``
  so the assistant token/done stream semantics stay untouched.

Default production generator calls Ai_Proxy credential resolution and an
OpenAI-compatible chat completion against the user's configured ``base_url``.
Tests continue to inject a deterministic ``plan_generator`` and never hit the
network.
"""

from dataclasses import dataclass
from datetime import date, datetime, timezone, timedelta
import json
import re
import uuid
from typing import Awaitable, Callable

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.entities import DailyTask, Phase, Plan
from app.services import document_service
from app.services.ai_proxy import (
    CredentialUnavailableError,
    build_outbound_headers,
    resolve_credential,
)
from app.services.api_config_service import (
    NoVerifiedApiConfigError,
    apply_reasoning_strength,
    require_verified_api_config,
)
from app.services.plan_draft_store import MAX_CLARIFY_ROUNDS, PlanDraft

# Required goal fields, in the stable order used for missing-field reporting
# and clarify questions (requirement 9.2).
REQUIRED_FIELDS = ("goalName", "goalDate", "currentLevel", "dailyMinutes")

# Human-readable clarify prompts per missing field (requirement 9.2/9.4).
_FIELD_PROMPTS = {
    "goalName": "目标名称",
    "goalDate": "目标日期",
    "currentLevel": "当前水平",
    "dailyMinutes": "每日可用学习时长",
}

# Requirement 9.1: a generated plan must contain 2 to 12 phases.
MIN_PHASES = 2
MAX_PHASES = 12

# Planner SSE event names (distinct from ai_proxy's token/error/done set).
PLAN_SSE_CLARIFY_EVENT = "clarify"
PLAN_SSE_NOTICE_EVENT = "notice"
PLAN_SSE_DONE_EVENT = "done"
PLAN_SSE_ERROR_EVENT = "error"
_PLAN_SSE_EVENTS = (
    PLAN_SSE_CLARIFY_EVENT,
    PLAN_SSE_NOTICE_EVENT,
    PLAN_SSE_DONE_EVENT,
    PLAN_SSE_ERROR_EVENT,
)


class PlanGenerationError(RuntimeError):
    """Raised when the AI-produced plan structure is invalid or unusable.

    The message is a safe, generic string suitable for surfacing to the client.
    """

    code = "PLAN_INVALID"

    def __init__(self, message: str = "规划生成失败，请稍后重试") -> None:
        super().__init__(message)


class PlanNotFoundError(RuntimeError):
    """Raised when a plan id does not resolve to a plan owned by the user.

    ``regenerate`` needs the existing row to update in place; a missing or
    foreign plan is indistinguishable to the caller, so ownership failures
    never disclose whether the id exists (requirement 10.2).
    """

    code = "PLAN_NOT_FOUND"

    def __init__(self, message: str = "学习规划不存在") -> None:
        super().__init__(message)


class PhaseNotFoundError(RuntimeError):
    """Raised when a phase id does not resolve to a phase the user owns.

    Same non-disclosure rule as :class:`PlanNotFoundError`: an id belonging to
    another user must be reported exactly like an unknown id (requirement 10.3).
    """

    code = "PHASE_NOT_FOUND"

    def __init__(self, message: str = "阶段不存在") -> None:
        super().__init__(message)


# A plan generator produces the raw plan structure for a set of goal fields.
# It is injectable so tests can substitute a deterministic structure and the
# real implementation (Ai_Proxy outbound call) can be wired in later. It
# receives the goal ``fields``, the ready ``used_docs`` set, the
# ``context_text`` retrieved from those ready documents (requirement 9.8/17.4)
# and the caller's natural-language instruction (empty on first generation,
# the user's edit request on regenerate, requirement 10.2).
PlanGenerator = Callable[
    [dict[str, object], list[str], str, str],
    "dict | Awaitable[dict]",
]


def _is_valid_goal_date(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def _is_valid_daily_minutes(value: object) -> bool:
    # Reject bools explicitly: bool is an int subclass but not a valid minute.
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return value > 0
    return False


def _is_present(field: str, value: object) -> bool:
    if value is None:
        return False
    if field == "goalDate":
        return _is_valid_goal_date(value)
    if field == "dailyMinutes":
        return _is_valid_daily_minutes(value)
    # goalName / currentLevel: any non-empty string.
    if isinstance(value, str):
        return bool(value.strip())
    return False


def missing_fields(payload: dict[str, object]) -> list[str]:
    """Return the required fields that are missing or invalid, in stable order.

    - ``goalDate`` that is not a valid ``YYYY-MM-DD`` date counts as missing.
    - ``dailyMinutes`` that is not a positive integer counts as missing.
    """
    return [
        field
        for field in REQUIRED_FIELDS
        if not _is_present(field, payload.get(field))
    ]


def clarify_question(missing: list[str]) -> str:
    """Build a clarify prompt that names exactly the missing fields (9.2)."""
    labels = [_FIELD_PROMPTS[field] for field in missing if field in _FIELD_PROMPTS]
    if not labels:
        return "请补充你的学习目标信息"
    return "请补充你的" + "、".join(labels)


def format_plan_sse(event: str, data: dict) -> str:
    """Encode one planner SSE frame ``event: <e>\\ndata: <json>\\n\\n``.

    Only the planner event set is permitted; an unknown event is a programming
    error, not client input. Payloads never carry any credential material.
    """
    if event not in _PLAN_SSE_EVENTS:
        raise ValueError(f"unsupported plan SSE event: {event!r}")
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


@dataclass(frozen=True)
class ClarifyOutcome:
    """The state machine decided another clarify round is needed."""

    round: int
    missing: list[str]
    question: str
    forced: bool = False


@dataclass(frozen=True)
class GenerateOutcome:
    """The state machine decided the planner should generate now."""

    fields: dict[str, object]
    forced: bool = False


def advance_state(
    draft: PlanDraft, updates: dict[str, object]
) -> ClarifyOutcome | GenerateOutcome:
    """Advance the clarify state machine for a reply to an existing draft.

    Merges the user's supplied fields, then decides (requirements 9.3-9.5):
    - If information is now complete -> ``GenerateOutcome``.
    - Else if the round cap has been reached -> forced ``GenerateOutcome``.
    - Else -> increment the round and return a ``ClarifyOutcome``.

    The round counter is strictly bounded by ``MAX_CLARIFY_ROUNDS``, so the
    machine always terminates (no infinite clarify loop).
    """
    fields = draft.fields
    for key, value in updates.items():
        if value is not None:
            fields[key] = value

    missing = missing_fields(fields)
    if not missing:
        return GenerateOutcome(fields=dict(fields))

    # Round cap reached: stop asking and generate from what we have (9.5).
    if draft.round >= MAX_CLARIFY_ROUNDS:
        return GenerateOutcome(fields=dict(fields), forced=True)

    draft.round += 1
    return ClarifyOutcome(
        round=draft.round,
        missing=missing,
        question=clarify_question(missing),
    )


def _today_utc() -> date:
    return datetime.now(timezone.utc).date()


def _coerce_date(value: object, fallback: date) -> date:
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return fallback
    return fallback


async def _run_generator(
    plan_generator: PlanGenerator,
    fields: dict[str, object],
    used_docs: list[str],
    context_text: str,
    instruction: str,
) -> dict:
    result = plan_generator(fields, used_docs, context_text, instruction)
    if hasattr(result, "__await__"):
        result = await result  # type: ignore[assignment]
    return result  # type: ignore[return-value]


_PLAN_SYSTEM_PROMPT = """你是 StudyPilot 考研学习规划助手。只输出一个 JSON 对象，不要 Markdown 说明。
JSON 形状必须为：
{"phases":[{"name":"阶段名","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","daily_tasks":[{"task_date":"YYYY-MM-DD","week_label":"W01","description":"任务描述"}]}]}
约束：phases 长度 2～12；面向考研（数学/英语/政治/专业课/复试/科研阅读）；daily_tasks 每阶段至少 1 条；日期合理递增。"""


def _build_plan_user_prompt(
    fields: dict[str, object],
    used_docs: list[str],
    context_text: str,
    instruction: str,
) -> str:
    parts = [
        "请根据以下考研目标生成复习规划 JSON：",
        f"- 目标名称：{fields.get('goalName')}",
        f"- 目标日期：{fields.get('goalDate')}",
        f"- 当前水平：{fields.get('currentLevel')}",
        f"- 每日可用分钟：{fields.get('dailyMinutes')}",
        f"- 就绪文档 id：{', '.join(used_docs) if used_docs else '无'}",
    ]
    if instruction.strip():
        parts.append(f"- 用户调整说明：{instruction.strip()}")
    if context_text.strip():
        # Bound context already truncated by document_service; keep prompt bounded.
        excerpt = context_text.strip()[:8000]
        parts.append("- 资料摘录（规划依据）：\n" + excerpt)
    return "\n".join(parts)


def _extract_assistant_text(payload: object) -> str:
    """Pull message text from common OpenAI-compatible response shapes."""
    if isinstance(payload, str):
        return payload
    if not isinstance(payload, dict):
        return ""
    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            message = first.get("message")
            if isinstance(message, dict) and isinstance(message.get("content"), str):
                return message["content"]
            if isinstance(first.get("text"), str):
                return first["text"]
    for key in ("output_text", "content", "result"):
        value = payload.get(key)
        if isinstance(value, str):
            return value
    return ""


def _parse_plan_structure_from_text(text: str) -> dict:
    """Parse model text into a plan structure dict; raise on failure."""
    cleaned = (text or "").strip()
    if not cleaned:
        raise PlanGenerationError()

    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned, re.IGNORECASE)
    if fenced:
        cleaned = fenced.group(1).strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise PlanGenerationError() from None
        try:
            parsed = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as error:
            raise PlanGenerationError() from error

    if not isinstance(parsed, dict):
        raise PlanGenerationError()
    return parsed


def _heuristic_plan_structure(fields: dict[str, object]) -> dict:
    """Deterministic 考研骨架：仅在模型输出无法解析时兜底，保证演示可闭环。"""
    today = _today_utc()
    goal = _coerce_date(fields.get("goalDate"), today + timedelta(days=180))
    span_days = max(30, (goal - today).days)
    mid = today + timedelta(days=span_days // 2)
    name = str(fields.get("goalName") or "考研复习")
    level = str(fields.get("currentLevel") or "待评估")
    return {
        "phases": [
            {
                "name": f"{name} · 基础夯实",
                "start_date": today.isoformat(),
                "end_date": mid.isoformat(),
                "daily_tasks": [
                    {
                        "task_date": today.isoformat(),
                        "week_label": "W01",
                        "description": f"梳理{level}薄弱点，建立考研科目知识清单",
                    },
                    {
                        "task_date": (today + timedelta(days=1)).isoformat(),
                        "week_label": "W01",
                        "description": "按资料完成一节精读与例题",
                    },
                ],
            },
            {
                "name": f"{name} · 强化冲刺",
                "start_date": (mid + timedelta(days=1)).isoformat(),
                "end_date": goal.isoformat(),
                "daily_tasks": [
                    {
                        "task_date": (mid + timedelta(days=1)).isoformat(),
                        "week_label": "W02",
                        "description": "真题/模拟卷限时训练与错题归档",
                    },
                    {
                        "task_date": (mid + timedelta(days=2)).isoformat(),
                        "week_label": "W02",
                        "description": "复盘薄弱模块并制定下周节奏",
                    },
                ],
            },
        ]
    }


async def _generate_structure_via_ai_proxy(
    session: Session,
    user_id: uuid.UUID,
    fields: dict[str, object],
    used_docs: list[str],
    context_text: str,
    instruction: str,
) -> dict:
    """Call the user's configured model via Ai_Proxy credentials + httpx POST.

    Does not change Ai_Proxy's SSE helpers; reuses ``resolve_credential`` /
    ``build_outbound_headers`` so the API key never enters the business JSON
    body. On unusable model output, falls back to a deterministic 考研骨架 so
    the product remains demoable without inventing a chat reply.
    """
    try:
        credential = resolve_credential(session, user_id)
    except (NoVerifiedApiConfigError, CredentialUnavailableError):
        raise
    except Exception as error:
        raise PlanGenerationError() from error

    payload = {
        "model": credential.model_type,
        "stream": False,
        "messages": [
            {"role": "system", "content": _PLAN_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": _build_plan_user_prompt(
                    fields, used_docs, context_text, instruction
                ),
            },
        ],
    }
    strength = fields.get("reasoningStrength") or fields.get("reasoning_strength")
    apply_reasoning_strength(payload, str(strength) if strength is not None else "standard")
    headers = {
        **build_outbound_headers(credential),
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                credential.base_url, headers=headers, json=payload
            )
    except Exception as error:
        raise PlanGenerationError() from error

    if response.status_code >= 400:
        raise PlanGenerationError()

    try:
        body = response.json()
    except Exception:
        body = response.text

    try:
        return _parse_plan_structure_from_text(_extract_assistant_text(body))
    except PlanGenerationError:
        # Model reachable but structure unusable — keep demo path alive.
        return _heuristic_plan_structure(fields)


def _bound_ai_plan_generator(
    session: Session, user_id: uuid.UUID
) -> PlanGenerator:
    """Bind DB session + user into the injectable PlanGenerator signature."""

    async def _bound(
        fields: dict[str, object],
        used_docs: list[str],
        context_text: str,
        instruction: str,
    ) -> dict:
        return await _generate_structure_via_ai_proxy(
            session, user_id, fields, used_docs, context_text, instruction
        )

    return _bound


def _resolve_plan_generator(
    session: Session,
    user_id: uuid.UUID,
    plan_generator: PlanGenerator | None,
) -> PlanGenerator:
    return plan_generator or _bound_ai_plan_generator(session, user_id)


@dataclass(frozen=True)
class GeneratedPlan:
    """Summary of a persisted plan returned to the caller/route.

    ``used_docs`` is the ready subset actually retrieved into the planning
    context; ``skipped_docs`` are the selected documents excluded because they
    were not yet ready (requirement 9.8/17.4).
    """

    plan_id: uuid.UUID
    phases: int
    used_docs: list[str]
    skipped_docs: list[str]


def _validate_structure(structure: dict) -> list[dict]:
    if not isinstance(structure, dict):
        raise PlanGenerationError()
    phases = structure.get("phases")
    if not isinstance(phases, list):
        raise PlanGenerationError()
    if not (MIN_PHASES <= len(phases) <= MAX_PHASES):
        raise PlanGenerationError()
    return phases


def _write_plan_structure(
    session: Session, plan: Plan, phases_data: list[dict], today: date
) -> None:
    """Replace ``plan``'s phases and daily tasks with ``phases_data``.

    Every existing Phase / Daily_Task of the plan is deleted first, so the child
    rows always describe exactly the newly generated structure — no orphaned
    phase survives a regeneration that shrank the plan. Callers own the commit.
    """
    session.execute(
        delete(DailyTask).where(DailyTask.plan_id == plan.id)
    )
    session.execute(delete(Phase).where(Phase.plan_id == plan.id))
    plan.total_phases = len(phases_data)
    session.flush()

    for offset, phase_data in enumerate(phases_data):
        phase_index = offset + 1
        phase_start = _coerce_date(phase_data.get("start_date"), today)
        phase_end = _coerce_date(phase_data.get("end_date"), phase_start)
        phase = Phase(
            plan_id=plan.id,
            phase_index=phase_index,
            name=str(phase_data.get("name", f"阶段 {phase_index}")),
            start_date=phase_start,
            end_date=phase_end,
            progress_percent=0,
            is_current=(phase_index == 1),
            is_completed=False,
        )
        session.add(phase)
        session.flush()  # assign phase.id before wiring daily tasks

        for task_data in phase_data.get("daily_tasks", []) or []:
            task_date = _coerce_date(
                task_data.get("task_date") if isinstance(task_data, dict) else None,
                phase_start,
            )
            if isinstance(task_data, dict):
                description = str(task_data.get("description", ""))
                week_label = str(task_data.get("week_label", ""))
            else:
                description = str(task_data)
                week_label = ""
            session.add(
                DailyTask(
                    plan_id=plan.id,
                    phase_id=phase.id,
                    task_date=task_date,
                    week_label=week_label,
                    description=description,
                    status="pending",
                )
            )


async def generate_plan(
    session: Session,
    user_id: uuid.UUID,
    fields: dict[str, object],
    document_ids: list[str] | None = None,
    plan_generator: PlanGenerator | None = None,
) -> GeneratedPlan:
    """Generate and persist a plan for a user with a verified API config.

    - Requires a verified API configuration first; when absent,
      ``NoVerifiedApiConfigError`` (NO_API_KEY) propagates and *nothing* is
      generated, called, or persisted.
    - Only ready documents feed the planning context; not-yet-ready selections
      are excluded and reported (requirements 9.7/9.8/17.4).
    - Runs the (injectable) plan generator, validates the phase count is within
      [2, 12], then writes Plan + Phases + Daily_Tasks in one transaction. A
      commit failure rolls back so no partial plan is left behind.
    """
    # Requirement 9 (and 2.13/3.5): block AI work without a verified config.
    require_verified_api_config(session, user_id)

    used_docs, skipped_docs = document_service.filter_ready_documents(
        session, user_id, document_ids
    )
    context_text = document_service.retrieve_document_chunks(
        session, user_id, used_docs
    )

    generator = _resolve_plan_generator(session, user_id, plan_generator)
    structure = await _run_generator(generator, fields, used_docs, context_text, "")
    phases_data = _validate_structure(structure)

    today = _today_utc()
    goal_date = _coerce_date(fields.get("goalDate"), today)
    daily_minutes = int(fields["dailyMinutes"])  # validated present by caller

    plan = Plan(
        user_id=user_id,
        goal_name=str(fields.get("goalName", "")),
        start_date=today,
        goal_date=goal_date,
        current_level=str(fields.get("currentLevel", "")),
        daily_minutes=daily_minutes,
        total_phases=len(phases_data),
    )
    session.add(plan)
    session.flush()  # assign plan.id before wiring phases/tasks

    _write_plan_structure(session, plan, phases_data, today)

    try:
        session.commit()
    except Exception:
        session.rollback()
        raise

    return GeneratedPlan(
        plan_id=plan.id,
        phases=len(phases_data),
        used_docs=used_docs,
        skipped_docs=skipped_docs,
    )


def _owned_plan(
    session: Session, user_id: uuid.UUID, plan_id: uuid.UUID
) -> Plan:
    """Return the user's plan or raise :class:`PlanNotFoundError`.

    The lookup filters on ``user_id``, so another user's plan is reported as
    missing rather than leaking its existence.
    """
    plan = session.scalar(
        select(Plan).where(Plan.id == plan_id, Plan.user_id == user_id)
    )
    if plan is None:
        raise PlanNotFoundError()
    return plan


def get_latest_plan(session: Session, user_id: uuid.UUID) -> Plan | None:
    """Return the user's most recently updated plan, or ``None``."""
    return session.scalar(
        select(Plan)
        .where(Plan.user_id == user_id)
        .order_by(Plan.updated_at.desc(), Plan.created_at.desc())
        .limit(1)
    )


def list_phases_for_plan(session: Session, plan_id: uuid.UUID) -> list[Phase]:
    """Return phases for a plan ordered by ``phase_index``."""
    return list(
        session.scalars(
            select(Phase)
            .where(Phase.plan_id == plan_id)
            .order_by(Phase.phase_index.asc())
        )
    )


async def regenerate_plan(
    session: Session,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    instruction: str,
    overrides: dict[str, object] | None = None,
    document_ids: list[str] | None = None,
    plan_generator: PlanGenerator | None = None,
) -> GeneratedPlan:
    """Re-generate an existing plan from a conversational edit request (10.2).

    The plan row itself is UPDATED — ``plan_id`` is deliberately preserved so
    the client keeps a stable reference to "对应记录". Only the fields the
    caller explicitly supplies (``overrides``) change; every other goal field
    is carried over from the stored plan, so a vague edit request like
    "把每天时间改成 3 小时" cannot blank out the goal name.

    Phases and Daily_Tasks are rebuilt wholesale from the new structure, in the
    same transaction as the plan update, so a failure leaves the previous plan
    fully intact.
    """
    require_verified_api_config(session, user_id)

    plan = _owned_plan(session, user_id, plan_id)

    fields: dict[str, object] = {
        "goalName": plan.goal_name,
        "goalDate": plan.goal_date.isoformat(),
        "currentLevel": plan.current_level,
        "dailyMinutes": plan.daily_minutes,
    }
    for key, value in (overrides or {}).items():
        if value is not None:
            fields[key] = value

    used_docs, skipped_docs = document_service.filter_ready_documents(
        session, user_id, document_ids
    )
    context_text = document_service.retrieve_document_chunks(
        session, user_id, used_docs
    )

    generator = _resolve_plan_generator(session, user_id, plan_generator)
    structure = await _run_generator(
        generator, fields, used_docs, context_text, instruction
    )
    phases_data = _validate_structure(structure)

    today = _today_utc()
    plan.goal_name = str(fields.get("goalName", plan.goal_name))
    plan.goal_date = _coerce_date(fields.get("goalDate"), plan.goal_date)
    plan.current_level = str(fields.get("currentLevel", plan.current_level))
    plan.daily_minutes = int(fields.get("dailyMinutes", plan.daily_minutes))
    session.flush()

    _write_plan_structure(session, plan, phases_data, today)

    try:
        session.commit()
    except Exception:
        session.rollback()
        raise

    return GeneratedPlan(
        plan_id=plan.id,
        phases=len(phases_data),
        used_docs=used_docs,
        skipped_docs=skipped_docs,
    )


# Fields a card-level manual tweak may touch (requirement 10.3). ``phase_index``
# and the derived progress flags are intentionally excluded: they are owned by
# the task-status linkage (requirement 16.2), not by manual editing.
PHASE_EDITABLE_FIELDS = ("name", "start_date", "end_date")


def update_phase(
    session: Session,
    user_id: uuid.UUID,
    phase_id: uuid.UUID,
    updates: dict[str, object],
) -> Phase:
    """Apply a partial manual tweak to one phase (requirement 10.3).

    Only keys present in ``updates`` with a non-``None`` value are written, so
    omitting a field leaves it untouched and an explicit ``None`` is treated as
    "no change" rather than a wipe. Every other phase row of the plan is never
    read for writing nor modified, which is what Property 14 asserts.
    """
    phase = session.scalar(
        select(Phase)
        .join(Plan, Plan.id == Phase.plan_id)
        .where(Phase.id == phase_id, Plan.user_id == user_id)
    )
    if phase is None:
        raise PhaseNotFoundError()

    for field in PHASE_EDITABLE_FIELDS:
        value = updates.get(field)
        if value is None:
            continue
        if field == "name":
            phase.name = str(value)
        else:  # start_date / end_date
            setattr(phase, field, _coerce_date(value, getattr(phase, field)))

    try:
        session.commit()
    except Exception:
        session.rollback()
        raise

    session.refresh(phase)
    return phase
