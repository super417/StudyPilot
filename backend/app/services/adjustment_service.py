"""Persistent plan-adjustment preview, confirm, reject, and undo."""

from __future__ import annotations

from datetime import date, timedelta
import copy
import hashlib
import json
import re
import uuid
from collections.abc import Callable

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.clock import local_today
from app.models.entities import DailyTask, Phase, Plan, PlanAdjustment, PracticeQuestion
from app.services import document_service, evidence_time, planner_service, resource_links, task_service
from app.services.api_config_service import require_verified_api_config
from app.services.planner_service import PlanGenerator, PlanGenerationError

# Test-only seams for controllable interleaving (independent connections).
# after_fingerprint: after basis read / before claim+write.
# after_claim: after claim UPDATE, before plan/task writes (may block on SQLite).
_confirm_after_fingerprint_hook: Callable[[Session, PlanAdjustment], None] | None = None
_confirm_between_claim_and_apply: Callable[[Session, PlanAdjustment], None] | None = None
# after the revise read is released and before the conditional UPDATE
_revise_before_claim: Callable[[Session, PlanAdjustment], None] | None = None


class AdjustmentNotFoundError(RuntimeError):
    code = "ADJUSTMENT_NOT_FOUND"

    def __init__(self, message: str = "调整预览不存在") -> None:
        super().__init__(message)


class AdjustmentConflictError(RuntimeError):
    code = "ADJUSTMENT_CONFLICT"

    def __init__(self, message: str = "调整已冲突，不能继续") -> None:
        super().__init__(message)


def basis_fingerprint(session: Session, plan: Plan) -> str:
    """Hash plan constraints, tasks, and answered-practice links."""
    phases = list(
        session.scalars(
            select(Phase)
            .where(Phase.plan_id == plan.id)
            .order_by(Phase.phase_index, Phase.id)
        )
    )
    tasks = list(
        session.scalars(
            select(DailyTask)
            .where(DailyTask.plan_id == plan.id)
            .order_by(DailyTask.task_date, DailyTask.id)
        )
    )
    answered = sorted(
        str(task_id)
        for task_id in task_service.answered_practice_task_ids(session, plan.id)
    )
    payload = {
        "plan": {
            "goalName": plan.goal_name,
            "goalDate": plan.goal_date.isoformat(),
            "startDate": plan.start_date.isoformat(),
            "currentLevel": plan.current_level,
            "dailyMinutes": plan.daily_minutes,
            "totalPhases": plan.total_phases,
        },
        "phases": [
            {
                "id": str(phase.id),
                "index": phase.phase_index,
                "name": phase.name,
                "start": phase.start_date.isoformat(),
                "end": phase.end_date.isoformat(),
            }
            for phase in phases
        ],
        "tasks": [
            {
                "id": str(task.id),
                "phaseId": str(task.phase_id),
                "date": task.task_date.isoformat(),
                "status": task.status,
                "description": task.description,
                "resourceUrl": task.resource_url,
                "weekLabel": task.week_label,
                "carriedFromId": str(task.carried_from_id)
                if task.carried_from_id
                else None,
                "estimatedMinutes": task.estimated_minutes,
            }
            for task in tasks
        ],
        "answeredTaskIds": answered,
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _snapshot_body(session: Session, plan: Plan) -> dict:
    phases = list(
        session.scalars(
            select(Phase)
            .where(Phase.plan_id == plan.id)
            .order_by(Phase.phase_index)
        )
    )
    tasks = list(
        session.scalars(
            select(DailyTask)
            .where(DailyTask.plan_id == plan.id)
            .order_by(DailyTask.task_date, DailyTask.id)
        )
    )
    return {
        "plan": {
            "goalName": plan.goal_name,
            "goalDate": plan.goal_date.isoformat(),
            "startDate": plan.start_date.isoformat(),
            "currentLevel": plan.current_level,
            "dailyMinutes": plan.daily_minutes,
            "totalPhases": plan.total_phases,
        },
        "phases": [
            {
                "id": str(phase.id),
                "phaseIndex": phase.phase_index,
                "name": phase.name,
                "startDate": phase.start_date.isoformat(),
                "endDate": phase.end_date.isoformat(),
                "progressPercent": phase.progress_percent,
                "isCurrent": phase.is_current,
                "isCompleted": phase.is_completed,
            }
            for phase in phases
        ],
        "dailyTasks": [
            {
                "id": str(task.id),
                "phaseId": str(task.phase_id),
                "taskDate": task.task_date.isoformat(),
                "weekLabel": task.week_label,
                "description": task.description,
                "status": task.status,
                "resourceUrl": task.resource_url,
                "carriedFromId": str(task.carried_from_id)
                if task.carried_from_id
                else None,
                "estimatedMinutes": task.estimated_minutes,
            }
            for task in tasks
        ],
    }


def _parse_iso_date(value: object) -> date | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _exact_apply_phases(
    phases_data: list[dict], today: date, goal: date
) -> tuple[list[dict], dict | None]:
    """Normalize phases without repairing illegal dates.

    A fully valid schedule that starts before today may be shifted onto today.
    That shift is returned so the preview can show it. Invalid or out-of-range
    tasks stay in the preview and fail the date check instead of being dropped.
    """
    working = [dict(phase) if isinstance(phase, dict) else phase for phase in phases_data]
    for phase in working:
        if isinstance(phase, dict) and isinstance(phase.get("daily_tasks"), list):
            phase["daily_tasks"] = [
                dict(task) if isinstance(task, dict) else task
                for task in phase["daily_tasks"]
            ]
    parsed_ok = True
    earliest: date | None = None
    for phase in working:
        if not isinstance(phase, dict):
            raise PlanGenerationError("阶段结构无效，无法生成预览")
        start = _parse_iso_date(phase.get("start_date"))
        end = _parse_iso_date(phase.get("end_date"))
        if start is None or end is None or start > end:
            parsed_ok = False
        elif earliest is None or start < earliest:
            earliest = start
        for task in phase.get("daily_tasks") or []:
            if not isinstance(task, dict):
                raise PlanGenerationError("任务结构无效，无法生成预览")
            task_date = _parse_iso_date(task.get("task_date"))
            if task_date is None:
                parsed_ok = False
            elif earliest is None or task_date < earliest:
                earliest = task_date
    delta = timedelta(0)
    note: dict | None = None
    if parsed_ok and earliest is not None and earliest < today:
        delta = today - earliest
        note = {"kind": "anchor_to_today", "deltaDays": delta.days}
    prepared: list[dict] = []
    action_index = 0
    for phase in working:
        if not isinstance(phase, dict):
            raise PlanGenerationError("阶段结构无效，无法生成预览")
        start = _parse_iso_date(phase.get("start_date"))
        end = _parse_iso_date(phase.get("end_date"))
        if parsed_ok and start is not None and end is not None:
            phase_start = (start + delta).isoformat()
            phase_end = (end + delta).isoformat()
        else:
            phase_start = str(phase.get("start_date") or "")
            phase_end = str(phase.get("end_date") or "")
        tasks_out: list[dict] = []
        for task in phase.get("daily_tasks") or []:
            if not isinstance(task, dict):
                raise PlanGenerationError("任务结构无效，无法生成预览")
            parsed_task = _parse_iso_date(task.get("task_date"))
            if parsed_ok and parsed_task is not None:
                task_date = (parsed_task + delta).isoformat()
            else:
                raw_date = task.get("task_date")
                task_date = "" if raw_date is None else str(raw_date)
            description = str(task.get("description", "")).strip()
            if not description:
                raise PlanGenerationError("任务描述为空，无法生成预览")
            try:
                if "estimated_minutes" in task or "estimatedMinutes" in task:
                    minutes = evidence_time.parse_estimated_minutes(
                        task.get("estimated_minutes", task.get("estimatedMinutes"))
                    )
                else:
                    minutes = None
            except ValueError as error:
                raise PlanGenerationError("预计分钟必须是正整数") from error
            tasks_out.append(
                {
                    "task_date": task_date,
                    "week_label": str(task.get("week_label") or ""),
                    "description": description,
                    "resource_url": resource_links.sanitize_resource_url(
                        task.get("resource_url")
                    ),
                    "estimated_minutes": minutes,
                    "action_id": f"a{action_index}",
                }
            )
            action_index += 1
        if not tasks_out:
            raise PlanGenerationError(
                "阶段缺少可执行的每日任务，无法生成预览（不会静默补任务）"
            )
        prepared.append(
            {
                "name": str(phase.get("name") or "阶段"),
                "start_date": phase_start,
                "end_date": phase_end,
                "daily_tasks": tasks_out,
            }
        )
    return prepared, note


def _build_diff(session: Session, plan: Plan, today: date, apply_phases: list[dict]) -> dict:
    current = list(
        session.scalars(select(DailyTask).where(DailyTask.plan_id == plan.id))
    )
    answered_ids = task_service.answered_practice_task_ids(session, plan.id)

    def _kept(task: DailyTask) -> bool:
        return task_service.task_is_protected(task, today) or task.id in answered_ids

    removable = [
        {
            "id": str(task.id),
            "actionId": f"r{index}",
            "taskDate": task.task_date.isoformat(),
            "description": task.description,
            "status": task.status,
            "estimatedMinutes": task.estimated_minutes,
        }
        for index, task in enumerate(task for task in current if not _kept(task))
    ]
    proposed = [
        {
            "actionId": task["action_id"],
            "taskDate": task["task_date"],
            "description": task["description"],
            "status": "pending",
            "estimatedMinutes": task.get("estimated_minutes"),
        }
        for phase in apply_phases
        for task in phase["daily_tasks"]
    ]
    return {
        "removedOrReplaced": removable,
        "proposedPending": proposed,
        "protectedKept": sum(1 for task in current if _kept(task)),
        "keptTasks": [
            {
                "id": str(task.id),
                "taskDate": task.task_date.isoformat(),
                "description": task.description,
                "status": task.status,
                "estimatedMinutes": task.estimated_minutes,
            }
            for task in current
            if _kept(task)
        ],
    }


def _diff_signature(diff: dict) -> dict:
    """Stable comparable shape for preview==confirm replace/propose sets."""
    return {
        "removed": sorted(
            (
                item["id"],
                item["taskDate"],
                item["description"],
                item["status"],
                item.get("estimatedMinutes"),
            )
            for item in (diff.get("removedOrReplaced") or [])
        ),
        "proposed": sorted(
            (
                item.get("actionId"),
                item["taskDate"],
                item["description"],
                item.get("status") or "pending",
                item.get("estimatedMinutes"),
            )
            for item in (diff.get("proposedPending") or [])
        ),
        "protectedKept": int(diff.get("protectedKept") or 0),
    }


def _ensure_confirm_applicable(
    session: Session,
    plan: Plan,
    row: PlanAdjustment,
    today: date,
    apply_phases: list[dict],
) -> None:
    """Reject confirm when preview can no longer be applied exactly (e.g. cross-day)."""
    for phase in apply_phases:
        for task in phase.get("daily_tasks") or []:
            task_date = planner_service._coerce_date(task.get("task_date"), today)
            if task_date < today:
                raise AdjustmentConflictError(
                    "预览任务已过期，不能静默少写；请重新生成预览"
                )
    live_diff = _build_diff(session, plan, today, apply_phases)
    if _diff_signature(live_diff) != _diff_signature(row.diff or {}):
        raise AdjustmentConflictError(
            "待替换或拟写入集合已变化，请重新生成预览"
        )
    proposed_count = len((row.diff or {}).get("proposedPending") or [])
    writable = sum(len(phase.get("daily_tasks") or []) for phase in apply_phases)
    if proposed_count != writable:
        raise AdjustmentConflictError("预览任务数与可写入内容不一致，请重新生成预览")


def _run_code_checks(
    apply_phases: list[dict],
    skipped_docs: list[str],
    *,
    evidence_status: str,
    duration_status: str,
    schedule_status: str,
    duration_days: list[dict],
    selection_status: str = "pass",
    date_note: dict | None = None,
) -> dict:
    """Structure, evidence, duration, and date checks. Unknown is not a pass."""
    task_count = sum(len(phase.get("daily_tasks") or []) for phase in apply_phases)
    structure_ok = len(apply_phases) >= 2 and task_count > 0
    checks = {
        "structure": "pass" if structure_ok else "fail",
        "protectedTaskRule": "pass",
        "selection": selection_status,
        "evidenceLocation": evidence_status,
        "duration": duration_status,
        "schedule": schedule_status,
    }
    ok = (
        structure_ok
        and selection_status == "pass"
        and evidence_status == "pass"
        and duration_status == "pass"
        and schedule_status == "pass"
    )
    result = {
        "ok": ok,
        "checks": checks,
        "protectedTaskRule": "keep_done_carried_past",
        "skippedDocs": skipped_docs,
        "durationDays": duration_days,
    }
    if date_note:
        result["dateAdjustment"] = date_note
    return result


_CANONICAL_GOAL_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_GOAL_DATE_ERROR = "目标日期必须是有效的 YYYY-MM-DD，请重新生成预览"


def _preview_goal(fields: dict, plan: Plan) -> date:
    """Use an explicit goal date only in canonical ``YYYY-MM-DD`` form.

    A missing goal keeps the current plan date. Compact ISO and other
    spellings of the same day are rejected here, so the preview cannot show
    a change that confirmation would ignore.
    """
    if "goalDate" not in fields or fields.get("goalDate") is None:
        return plan.goal_date
    raw = fields.get("goalDate")
    if not isinstance(raw, str) or _CANONICAL_GOAL_DATE.fullmatch(raw) is None:
        raise PlanGenerationError(_GOAL_DATE_ERROR)
    try:
        parsed = date.fromisoformat(raw)
    except ValueError as error:
        raise PlanGenerationError(_GOAL_DATE_ERROR) from error
    if parsed.isoformat() != raw:
        raise PlanGenerationError(_GOAL_DATE_ERROR)
    return parsed


def _preview_cap(fields: dict, plan: Plan) -> int:
    raw = fields.get("dailyMinutes", plan.daily_minutes)
    if isinstance(raw, bool) or not isinstance(raw, int) or raw <= 0:
        raise PlanGenerationError("每日分钟必须是正整数")
    return raw


def _kept_future_and_minutes(
    session: Session,
    plan: Plan,
    today: date,
    goal: date,
    apply_phases: list[dict],
) -> tuple[list[tuple[date, int | None]], list[date]]:
    current = list(
        session.scalars(select(DailyTask).where(DailyTask.plan_id == plan.id))
    )
    answered_ids = task_service.answered_practice_task_ids(session, plan.id)
    dated: list[tuple[date, int | None]] = []
    protected_future: list[date] = []
    for task in current:
        kept = task_service.task_is_protected(task, today) or task.id in answered_ids
        if not kept:
            continue
        if task.task_date >= today:
            protected_future.append(task.task_date)
        if today <= task.task_date <= goal:
            dated.append((task.task_date, task.estimated_minutes))
    for phase in apply_phases:
        for task in phase.get("daily_tasks") or []:
            try:
                task_date = date.fromisoformat(str(task["task_date"]))
            except ValueError:
                continue
            dated.append((task_date, task.get("estimated_minutes")))
    return dated, protected_future


def _evidence_bundle(
    instruction: str,
    apply_phases: list[dict],
    snapshot: list[dict],
    citations: list[dict] | None,
    removed: list[dict],
) -> tuple[list[dict], str]:
    """Check model citations against the snapshot that entered the prompt.

    Chunks the model did not cite stay out of document evidence. A separate
    retrieval list may be shown later, but it does not count as model use.
    """
    accepted, fabricated = evidence_time.check_model_citations(snapshot, citations)
    allowed = {
        (str(item.get("docId")), int(item.get("chunkIndex"))) for item in accepted
    }
    document_hits = [
        hit
        for hit in snapshot
        if (str(hit.get("docId")), int(hit.get("chunkIndex"))) in allowed
    ]
    proposed_ids = [
        str(task["action_id"])
        for phase in apply_phases
        for task in phase.get("daily_tasks") or []
    ]
    refs: list[dict] = []
    if instruction.strip():
        refs.append(
            {
                "kind": "constraint",
                "actionIds": proposed_ids,
                "text": instruction.strip(),
                "source": "user_instruction",
            }
        )
    for item in removed:
        refs.append(
            {
                "kind": "task",
                "actionId": item.get("actionId"),
                "taskId": item.get("id"),
                "taskDate": item.get("taskDate"),
                "description": item.get("description"),
                "status": item.get("status"),
                "estimatedMinutes": item.get("estimatedMinutes"),
            }
        )
    for hit in document_hits:
        linked = [
            str(task["action_id"])
            for phase in apply_phases
            for task in phase.get("daily_tasks") or []
            if evidence_time.overlap_terms(
                str(task.get("description") or ""), str(hit.get("snippet") or "")
            )
        ]
        refs.append(
            {
                "kind": "document",
                "actionIds": linked,
                "docId": hit.get("docId"),
                "chunkIndex": hit.get("chunkIndex"),
                "filename": hit.get("filename"),
                "snippet": hit.get("snippet"),
                "pageStart": hit.get("pageStart"),
                "matchedTerms": hit.get("matchedTerms") or [],
                "contentHash": hit.get("contentHash"),
                "literatureSupport": "suggestion",
            }
        )
    if fabricated:
        return refs, "fail"
    covered: set[str] = set()
    for ref in refs:
        if ref.get("kind") == "retrieval":
            continue
        for action_id in ref.get("actionIds") or []:
            covered.add(action_id)
        if ref.get("actionId"):
            covered.add(ref.get("actionId"))
    if not proposed_ids or any(action_id not in covered for action_id in proposed_ids):
        return refs, "insufficient"
    return refs, "pass"


def _selection_version(proposal: dict | None) -> int | None:
    raw = (proposal or {}).get("selectionVersion")
    if isinstance(raw, bool) or not isinstance(raw, int) or raw <= 0:
        return None
    return raw


def _stored_snapshot(proposal: dict | None) -> list[dict]:
    raw = (proposal or {}).get("promptSnapshot") or {}
    hits = raw.get("hits") if isinstance(raw, dict) else None
    return [dict(item) for item in hits or []]


def _candidate_rows(phases: list[dict]) -> list[dict]:
    rows: list[dict] = []
    for phase in phases:
        for task in phase.get("daily_tasks") or []:
            rows.append(
                {
                    "actionId": task.get("action_id"),
                    "taskDate": task.get("task_date"),
                    "description": task.get("description"),
                    "estimatedMinutes": task.get("estimated_minutes"),
                    "phaseName": phase.get("name"),
                }
            )
    return rows


def _plan_field_changes(plan: Plan, fields: dict) -> list[dict]:
    pairs = (
        ("goalName", plan.goal_name, fields.get("goalName")),
        ("goalDate", plan.goal_date.isoformat(), fields.get("goalDate")),
        ("currentLevel", plan.current_level, fields.get("currentLevel")),
        ("dailyMinutes", plan.daily_minutes, fields.get("dailyMinutes")),
    )
    changes: list[dict] = []
    for field, before, after in pairs:
        if after is None or str(before) == str(after):
            continue
        changes.append({"field": field, "before": before, "after": after})
    return changes


def _selection_status(phases: list[dict]) -> str:
    if any(not (phase.get("daily_tasks") or []) for phase in phases):
        return "fail"
    return "pass"


def _assess_preview(
    session: Session,
    user_id: uuid.UUID,
    plan: Plan,
    instruction: str,
    apply_phases: list[dict],
    snapshot: list[dict],
    citations: list[dict] | None,
    removed: list[dict],
    fields: dict,
    skipped_docs: list[str],
    today: date,
    date_note: dict | None = None,
) -> tuple[dict, list[dict]]:
    del user_id
    goal = _preview_goal(fields, plan)
    cap = _preview_cap(fields, plan)
    dated, protected_future = _kept_future_and_minutes(
        session, plan, today, goal, apply_phases
    )
    duration = evidence_time.duration_report(dated, cap, today, goal)
    schedule = evidence_time.check_schedule_order(
        apply_phases, goal, protected_future, today=today
    )
    refs, evidence_status = _evidence_bundle(
        instruction, apply_phases, snapshot, citations, removed
    )
    validation = _run_code_checks(
        apply_phases,
        skipped_docs,
        evidence_status=evidence_status,
        duration_status=str(duration["result"]),
        schedule_status=schedule,
        duration_days=list(duration["days"]),
        selection_status=_selection_status(apply_phases),
        date_note=date_note,
    )
    return validation, refs


def _sources_still_available(session: Session, user_id: uuid.UUID, refs: list[dict]) -> bool:
    for ref in refs:
        if ref.get("kind") != "document":
            continue
        if evidence_time.lookup_document_ref(session, user_id, ref) != "available":
            return False
    return True


def _public_adjustment(row: PlanAdjustment) -> dict:
    return {
        "id": str(row.id),
        "planId": str(row.plan_id),
        "status": row.status,
        "instruction": row.instruction,
        "diff": row.diff,
        "validation": row.validation,
        "steps": row.steps,
        "decisionSummary": row.decision_summary,
        "evidenceRefs": row.evidence_refs,
        "selectionVersion": int((row.proposal or {}).get("selectionVersion") or 1),
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
    }


def get_adjustment(
    session: Session,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    adjustment_id: uuid.UUID,
) -> PlanAdjustment:
    planner_service._owned_plan(session, user_id, plan_id)
    row = session.scalar(
        select(PlanAdjustment).where(
            PlanAdjustment.id == adjustment_id,
            PlanAdjustment.plan_id == plan_id,
            PlanAdjustment.user_id == user_id,
        )
    )
    if row is None:
        raise AdjustmentNotFoundError()
    return row


async def create_preview(
    session: Session,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    instruction: str,
    overrides: dict[str, object] | None,
    document_ids: list[str] | None,
    plan_generator: PlanGenerator | None = None,
) -> PlanAdjustment:
    """Generate a durable preview. Does not mutate the live plan."""
    require_verified_api_config(session, user_id)
    plan = planner_service._owned_plan(session, user_id, plan_id)
    fields: dict[str, object] = {
        "goalName": plan.goal_name,
        "goalDate": plan.goal_date.isoformat(),
        "currentLevel": plan.current_level,
        "dailyMinutes": plan.daily_minutes,
    }
    for key, value in (overrides or {}).items():
        if value is not None:
            fields[key] = value
    if overrides and "goalDate" in overrides and overrides.get("goalDate") is not None:
        _preview_goal(fields, plan)

    used_docs, skipped_docs = document_service.filter_ready_documents(
        session, user_id, document_ids
    )
    existing_tasks = list(
        session.scalars(select(DailyTask).where(DailyTask.plan_id == plan.id))
    )
    query = " ".join(
        [instruction] + [task.description for task in existing_tasks if task.description]
    )
    chunks = evidence_time.load_owned_chunks(session, user_id, used_docs)

    def render_prompt(context: str) -> str:
        return planner_service._build_plan_user_prompt(
            fields, used_docs, context, instruction
        )

    context_text, snapshot = evidence_time.snapshot_for_prompt(
        chunks, query, render_prompt
    )
    generator = planner_service._resolve_plan_generator(
        session, user_id, plan_generator
    )
    structure = await planner_service._run_generator(
        generator, fields, used_docs, context_text, instruction
    )
    phases_data = planner_service._validate_structure(structure)
    today = local_today()
    preview_goal = _preview_goal(fields, plan)
    apply_phases, date_note = _exact_apply_phases(phases_data, today, preview_goal)
    fingerprint = basis_fingerprint(session, plan)
    diff = _build_diff(session, plan, today, apply_phases)
    diff["planChanges"] = _plan_field_changes(plan, fields)
    diff["candidates"] = _candidate_rows(apply_phases)
    citations = structure.get("citations") if isinstance(structure.get("citations"), list) else None
    validation, evidence_refs = _assess_preview(
        session,
        user_id,
        plan,
        instruction,
        apply_phases,
        snapshot,
        citations,
        list(diff["removedOrReplaced"]),
        fields,
        skipped_docs,
        today,
        date_note=date_note,
    )
    steps = [
        {"step": "collect_instruction", "result": "ok"},
        {
            "step": "generate_proposal",
            "result": "ok",
            "mock": plan_generator is not None,
        },
        {
            "step": "rule_check",
            "result": "ok" if validation["ok"] else "fail",
            "checks": validation["checks"],
        },
        {"step": "await_confirm", "result": "pending"},
    ]
    if validation["checks"]["structure"] != "pass":
        raise PlanGenerationError("结构调整未通过校验，无法生成预览")
    summary = (
        f"预览：将替换 {len(diff['removedOrReplaced'])} 条未受保护任务，"
        f"提出 {len(diff['proposedPending'])} 条新安排，"
        f"保留 {diff['protectedKept']} 条历史任务。尚未写入规划。"
    )
    if not validation["ok"]:
        summary += " 时长、日期或依据未通过，不能确认。"
    row = PlanAdjustment(
        user_id=user_id,
        plan_id=plan.id,
        status="pending",
        instruction=instruction,
        basis_fingerprint=fingerprint,
        proposal={
            "fields": fields,
            "phases": apply_phases,
            "candidatePhases": copy.deepcopy(apply_phases),
            "usedDocs": used_docs,
            "skippedDocs": skipped_docs,
            "citations": citations or [],
            "selectionVersion": 1,
            "promptSnapshot": {"hits": snapshot},
            "baseEvidenceRefs": evidence_refs,
        },
        diff=diff,
        validation=validation,
        steps=steps,
        decision_summary=summary,
        evidence_refs=evidence_refs,
    )
    session.add(row)
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(row)
    return row


def reject_adjustment(
    session: Session,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    adjustment_id: uuid.UUID,
) -> PlanAdjustment:
    planner_service._owned_plan(session, user_id, plan_id)
    claimed = session.execute(
        update(PlanAdjustment)
        .where(
            PlanAdjustment.id == adjustment_id,
            PlanAdjustment.plan_id == plan_id,
            PlanAdjustment.user_id == user_id,
            PlanAdjustment.status == "pending",
        )
        .values(status="rejected")
    )
    if claimed.rowcount != 1:
        row = session.scalar(
            select(PlanAdjustment).where(PlanAdjustment.id == adjustment_id)
        )
        if row is None or row.user_id != user_id or row.plan_id != plan_id:
            raise AdjustmentNotFoundError()
        raise AdjustmentConflictError("只有待确认的预览可以拒绝")
    row = session.get(PlanAdjustment, adjustment_id)
    assert row is not None
    row.steps = list(row.steps or []) + [{"step": "reject", "result": "ok"}]
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(row)
    return row


def revise_preview(
    session: Session,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    adjustment_id: uuid.UUID,
    keep_action_ids: list[str],
    minute_overrides: dict[str, int] | None,
    selection_version: int,
) -> PlanAdjustment:
    """Edit the pending preview only. Does not write the live plan.

    The candidate set stays intact. The write is a conditional UPDATE on the
    pending row and the version that was read, after that read is released.
    """
    global _revise_before_claim
    plan = planner_service._owned_plan(session, user_id, plan_id)
    row = get_adjustment(session, user_id, plan_id, adjustment_id)
    if row.status != "pending":
        raise AdjustmentConflictError("只有待确认的预览可以调整")
    stored_version = _selection_version(row.proposal)
    if stored_version is None or selection_version != stored_version:
        raise AdjustmentConflictError("预览选择版本已变化，请使用最新结果")
    proposal = dict(row.proposal or {})
    candidates = copy.deepcopy(
        list(proposal.get("candidatePhases") or proposal.get("phases") or [])
    )
    known = {
        str(task.get("action_id"))
        for phase in candidates
        for task in phase.get("daily_tasks") or []
    }
    unknown = [item for item in keep_action_ids if item not in known]
    if unknown:
        raise AdjustmentConflictError("选择包含未知任务，请使用预览中的任务")
    keep = set(keep_action_ids)
    saved: dict[str, int] = {}
    stored_saved = proposal.get("savedMinutes") or {}
    if isinstance(stored_saved, dict):
        for key, value in stored_saved.items():
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                continue
            saved[str(key)] = value
    if "modelMinutes" not in proposal:
        proposal["modelMinutes"] = {
            str(task.get("action_id")): task.get("estimated_minutes")
            for phase in candidates
            for task in phase.get("daily_tasks") or []
        }
    for action_id, raw in (minute_overrides or {}).items():
        try:
            saved[str(action_id)] = evidence_time.parse_estimated_minutes(raw)
        except ValueError as error:
            raise AdjustmentConflictError("预计分钟必须是正整数") from error
    for phase in candidates:
        for task in phase.get("daily_tasks") or []:
            action_id = str(task.get("action_id"))
            if action_id in saved:
                task["estimated_minutes"] = saved[action_id]
    phases = copy.deepcopy(candidates)
    for phase in phases:
        phase["daily_tasks"] = [
            task
            for task in phase.get("daily_tasks") or []
            if str(task.get("action_id")) in keep
        ]
    today = local_today()
    previous_ids = {
        item["id"] for item in (row.diff or {}).get("removedOrReplaced") or []
    }
    diff = _build_diff(session, plan, today, phases)
    new_ids = {item["id"] for item in diff["removedOrReplaced"]}
    if new_ids != previous_ids:
        raise AdjustmentConflictError("待替换集合已变化，请重新生成预览")
    fields = dict(proposal.get("fields") or {})
    diff["planChanges"] = _plan_field_changes(plan, fields)
    diff["candidates"] = _candidate_rows(candidates)
    snapshot = _stored_snapshot(proposal)
    validation, evidence_refs = _assess_preview(
        session,
        user_id,
        plan,
        row.instruction,
        phases,
        snapshot,
        list(proposal.get("citations") or []) or None,
        list(diff["removedOrReplaced"]),
        fields,
        list(proposal.get("skippedDocs") or []),
        today,
        date_note=(row.validation or {}).get("dateAdjustment"),
    )
    next_version = stored_version + 1
    proposal["phases"] = phases
    proposal["candidatePhases"] = candidates
    proposal["savedMinutes"] = saved
    proposal["selectionVersion"] = next_version
    proposal["baseEvidenceRefs"] = list(proposal.get("baseEvidenceRefs") or evidence_refs)
    steps = list(row.steps or []) + [
        {
            "step": "revise",
            "result": "ok" if validation["ok"] else "fail",
            "selectionVersion": next_version,
        }
    ]
    summary = (
        f"预览：将替换 {len(diff['removedOrReplaced'])} 条未受保护任务，"
        f"提出 {len(diff['proposedPending'])} 条新安排，"
        f"保留 {diff['protectedKept']} 条历史任务。尚未写入规划。"
    )
    if not validation["ok"]:
        summary += " 时长、日期或依据未通过，不能确认。"
    fingerprint = row.basis_fingerprint
    adjustment_id_value = row.id
    hook = _revise_before_claim
    _revise_before_claim = None
    try:
        session.rollback()
        if hook is not None:
            hook(session, row)
    finally:
        _revise_before_claim = hook
    claimed = session.execute(
        update(PlanAdjustment)
        .where(
            PlanAdjustment.id == adjustment_id_value,
            PlanAdjustment.status == "pending",
            func.json_extract(PlanAdjustment.proposal, "$.selectionVersion")
            == stored_version,
        )
        .values(
            proposal=proposal,
            diff=diff,
            validation=validation,
            evidence_refs=evidence_refs,
            steps=steps,
            decision_summary=summary,
        )
    )
    if claimed.rowcount != 1:
        session.rollback()
        raise AdjustmentConflictError("预览选择版本已变化，请使用最新结果")
    session.expire_all()
    fresh = session.get(PlanAdjustment, adjustment_id_value)
    if fresh is None:
        session.rollback()
        raise AdjustmentNotFoundError()
    if fresh.status != "pending" or _selection_version(fresh.proposal) != next_version:
        session.rollback()
        raise AdjustmentConflictError("预览选择版本已变化，请使用最新结果")
    live_plan = planner_service._owned_plan(session, user_id, plan_id)
    if basis_fingerprint(session, live_plan) != fingerprint:
        session.rollback()
        raise AdjustmentConflictError("规划或任务已变化，请重新生成预览")
    if not _sources_still_available(session, user_id, list(fresh.evidence_refs or [])):
        checks = dict(fresh.validation.get("checks") or {})
        checks["evidenceLocation"] = "fail"
        fresh.validation = {**dict(fresh.validation or {}), "ok": False, "checks": checks}
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(fresh)
    return fresh


def _practice_is_answered(row: PracticeQuestion) -> bool:
    """User feedback uses status; ``answer`` is the reference key, not submission."""
    return task_service.practice_is_answered(row.status)


def _recheck_pending(
    session: Session,
    user_id: uuid.UUID,
    plan: Plan,
    row: PlanAdjustment,
    today: date,
) -> dict:
    """Recompute duration, dates, and whether cited sources still match."""
    fields = dict((row.proposal or {}).get("fields") or {})
    phases = list((row.proposal or {}).get("phases") or [])
    validation, _refs = _assess_preview(
        session,
        user_id,
        plan,
        row.instruction,
        phases,
        _stored_snapshot(row.proposal),
        list((row.proposal or {}).get("citations") or []) or None,
        list((row.diff or {}).get("removedOrReplaced") or []),
        fields,
        list((row.proposal or {}).get("skippedDocs") or []),
        today,
        date_note=(row.validation or {}).get("dateAdjustment"),
    )
    if not _sources_still_available(session, user_id, list(row.evidence_refs or [])):
        checks = dict(validation["checks"])
        checks["evidenceLocation"] = "fail"
        validation = {**validation, "ok": False, "checks": checks}
    return validation


def _mark_confirm_conflict(
    session: Session, row: PlanAdjustment, reason: str
) -> PlanAdjustment | None:
    """pending→conflict only. Never overwrite confirmed/rejected/undone.

    Rolls back this session first so a stale snapshot cannot commit over another
    transaction's success, and so a failed claim does not leave a partial write.
    Returns the already-confirmed row when the caller should treat confirm as done.
    """
    adjustment_id = row.id
    session.rollback()
    fresh = session.get(PlanAdjustment, adjustment_id)
    if fresh is None:
        raise AdjustmentNotFoundError()
    if fresh.status == "confirmed":
        return fresh
    if fresh.status != "pending":
        raise AdjustmentConflictError("该预览不能确认")
    steps = list(fresh.steps or []) + [
        {"step": "confirm", "result": "conflict", "reason": reason}
    ]
    claimed = session.execute(
        update(PlanAdjustment)
        .where(
            PlanAdjustment.id == adjustment_id,
            PlanAdjustment.status == "pending",
        )
        .values(status="conflict", steps=steps)
    )
    if claimed.rowcount != 1:
        session.rollback()
        fresh = session.get(PlanAdjustment, adjustment_id)
        if fresh is not None and fresh.status == "confirmed":
            return fresh
        raise AdjustmentConflictError("该预览不能确认")
    session.commit()
    session.refresh(fresh)
    return None


def _confirm_or_conflict(
    session: Session, row: PlanAdjustment, reason: str, message: str
) -> PlanAdjustment:
    winner = _mark_confirm_conflict(session, row, reason)
    if winner is not None:
        return winner
    raise AdjustmentConflictError(message)


def confirm_adjustment(
    session: Session,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    adjustment_id: uuid.UUID,
    expected_selection_version: int | None = None,
) -> PlanAdjustment:
    # Drop identity-map cache so fingerprint sees concurrent task/plan edits.
    session.expire_all()
    plan = planner_service._owned_plan(session, user_id, plan_id)
    row = session.scalar(
        select(PlanAdjustment).where(
            PlanAdjustment.id == adjustment_id,
            PlanAdjustment.plan_id == plan_id,
            PlanAdjustment.user_id == user_id,
        )
    )
    if row is None:
        raise AdjustmentNotFoundError()
    if row.status == "confirmed":
        return row
    if row.status != "pending":
        raise AdjustmentConflictError("该预览不能确认")
    if expected_selection_version is None:
        raise AdjustmentConflictError("请提交已查看的选择版本后再确认，或重新生成预览")
    if not (row.validation or {}).get("ok", False):
        raise AdjustmentConflictError("预览未通过校验，不能确认")
    stored_version = _selection_version(row.proposal)
    if stored_version is None or expected_selection_version != stored_version:
        raise AdjustmentConflictError("预览选择已更新，请查看重新计算后的结果再确认")
    try:
        _preview_goal(dict((row.proposal or {}).get("fields") or {}), plan)
    except PlanGenerationError as error:
        raise AdjustmentConflictError(str(error)) from error

    today = local_today()
    apply_phases = list((row.proposal or {}).get("phases") or [])
    if not apply_phases:
        raise AdjustmentConflictError("预览缺少可应用的阶段内容")
    for phase in apply_phases:
        if not (phase.get("daily_tasks") or []):
            raise AdjustmentConflictError("预览缺少可执行任务")

    current_fp = basis_fingerprint(session, plan)
    if current_fp != row.basis_fingerprint:
        return _confirm_or_conflict(
            session, row, "basis_changed", "规划或任务已变化，请重新生成预览"
        )

    try:
        _ensure_confirm_applicable(session, plan, row, today, apply_phases)
    except AdjustmentConflictError:
        return _confirm_or_conflict(
            session,
            row,
            "preview_not_applicable",
            "待替换或拟写入集合已变化，请重新生成预览",
        )

    recheck = _recheck_pending(session, user_id, plan, row, today)
    if not recheck["ok"]:
        return _confirm_or_conflict(
            session, row, "recheck_failed", "确认前重新校验失败"
        )

    fp_hook = _confirm_after_fingerprint_hook
    if fp_hook is not None:
        fp_hook(session, row)
        session.expire_all()
        plan = planner_service._owned_plan(session, user_id, plan_id)
        row = session.get(PlanAdjustment, adjustment_id)
        assert row is not None
        if row.status == "confirmed":
            return row
        if row.status != "pending":
            raise AdjustmentConflictError("该预览不能确认")
        if _selection_version(row.proposal) != expected_selection_version:
            raise AdjustmentConflictError("预览选择已更新，请查看重新计算后的结果再确认")
        apply_phases = list((row.proposal or {}).get("phases") or [])
        current_fp = basis_fingerprint(session, plan)
        if current_fp != row.basis_fingerprint:
            return _confirm_or_conflict(
                session, row, "basis_changed", "规划或任务已变化，请重新生成预览"
            )
        try:
            _ensure_confirm_applicable(
                session, plan, row, local_today(), apply_phases
            )
        except AdjustmentConflictError:
            return _confirm_or_conflict(
                session,
                row,
                "preview_not_applicable",
                "待替换或拟写入集合已变化，请重新生成预览",
            )

    # Atomic claim: only one concurrent confirm/reject wins (SQLite UPDATE).
    claimed = session.execute(
        update(PlanAdjustment)
        .where(
            PlanAdjustment.id == adjustment_id,
            PlanAdjustment.status == "pending",
            PlanAdjustment.basis_fingerprint == current_fp,
            func.json_extract(PlanAdjustment.proposal, "$.selectionVersion")
            == expected_selection_version,
        )
        .values(status="confirmed")
    )
    if claimed.rowcount != 1:
        session.rollback()
        fresh = session.get(PlanAdjustment, adjustment_id)
        if fresh is not None and fresh.status == "confirmed":
            return fresh
        raise AdjustmentConflictError("该预览不能确认")

    session.refresh(row)

    def _revalidate_live_basis() -> None:
        session.expire_all()
        live_plan = planner_service._owned_plan(session, user_id, plan_id)
        live_row = session.get(PlanAdjustment, adjustment_id)
        assert live_row is not None
        if live_row.status != "confirmed":
            raise AdjustmentConflictError("该预览不能确认")
        if _selection_version(live_row.proposal) != expected_selection_version:
            raise AdjustmentConflictError("预览选择已更新，请查看重新计算后的结果再确认")
        if basis_fingerprint(session, live_plan) != live_row.basis_fingerprint:
            raise AdjustmentConflictError("规划或任务已变化，请重新生成预览")
        _ensure_confirm_applicable(
            session, live_plan, live_row, local_today(), apply_phases
        )
        live_check = _recheck_pending(
            session, user_id, live_plan, live_row, local_today()
        )
        if not live_check["ok"]:
            raise AdjustmentConflictError("确认前重新校验失败")

    try:
        _revalidate_live_basis()
        claim_hook = _confirm_between_claim_and_apply
        if claim_hook is not None:
            claim_hook(session, row)
            _revalidate_live_basis()
    except AdjustmentConflictError:
        session.expire_all()
        live = session.get(PlanAdjustment, adjustment_id)
        if live is None:
            raise
        return _confirm_or_conflict(
            session, live, "stale_after_claim", "规划或任务已变化，请重新生成预览"
        )

    session.expire_all()
    plan = planner_service._owned_plan(session, user_id, plan_id)
    row = session.get(PlanAdjustment, adjustment_id)
    assert row is not None
    before = _snapshot_body(session, plan)
    before_ids = {item["id"] for item in before["dailyTasks"]}
    before_phase_ids = {item["id"] for item in before["phases"]}
    today = local_today()
    fields = dict(row.proposal.get("fields") or {})
    plan_field_changes = {}
    for key, attr, cast in (
        ("goalName", "goal_name", str),
        ("goalDate", "goal_date", lambda v: _preview_goal({"goalDate": v}, plan)),
        ("currentLevel", "current_level", str),
        ("dailyMinutes", "daily_minutes", int),
    ):
        if key not in fields:
            continue
        new_val = cast(fields[key])
        old_val = getattr(plan, attr)
        if new_val != old_val:
            plan_field_changes[attr] = {
                "before": old_val.isoformat() if isinstance(old_val, date) else old_val,
                "after": new_val.isoformat() if isinstance(new_val, date) else new_val,
            }
            setattr(plan, attr, new_val)
    session.flush()
    planner_service._write_plan_structure(
        session, plan, copy.deepcopy(apply_phases), today, reason="adjustment", exact=True
    )
    session.flush()
    after = _snapshot_body(session, plan)
    answered_ids = {
        str(task_id)
        for task_id in task_service.answered_practice_task_ids(session, plan.id)
    }
    removed_ids = [
        item["id"]
        for item in (row.diff or {}).get("removedOrReplaced") or []
    ]
    # Keep answered-linked tasks even if they were somehow listed; never record them removed.
    removed_ids = [task_id for task_id in removed_ids if task_id not in answered_ids]
    created_ids = [
        item["id"] for item in after["dailyTasks"] if item["id"] not in before_ids
    ]
    created_phase_ids = [
        item["id"] for item in after["phases"] if item["id"] not in before_phase_ids
    ]
    after_by_id = {
        item["id"]: item for item in after["dailyTasks"] if item["id"] in created_ids
    }
    after_phases = {
        item["id"]: item for item in after["phases"] if item["id"] in created_phase_ids
    }
    # Exact write must match the preview propose count — refuse silent short writes.
    if len(created_ids) != len((row.diff or {}).get("proposedPending") or []):
        live = session.get(PlanAdjustment, adjustment_id)
        if live is None:
            session.rollback()
            raise AdjustmentConflictError(
                "确认写入条数与预览不一致，已拒绝；请重新生成预览"
            )
        return _confirm_or_conflict(
            session,
            live,
            "write_count_mismatch",
            "确认写入条数与预览不一致，已拒绝；请重新生成预览",
        )
    row.applied_record = {
        "before": before,
        "after_created": after_by_id,
        "after_phases": after_phases,
        "removed_ids": removed_ids,
        "created_ids": created_ids,
        "created_phase_ids": created_phase_ids,
        "plan_before": before["plan"],
        "plan_after": after["plan"],
        "plan_field_changes": plan_field_changes,
        "apply_phases": apply_phases,
    }
    row.steps = list(row.steps or []) + [
        {"step": "confirm", "result": "applied", "checks": recheck["checks"]}
    ]
    row.decision_summary = (
        f"已确认：替换 {len(removed_ids)} 条未受保护任务，"
        f"写入 {len(created_ids)} 条新任务；历史任务保留。"
    )
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(row)
    return row


def _task_changed_from_expected(task: DailyTask | None, expected: dict) -> bool:
    if task is None:
        return True
    expected_carried = expected.get("carriedFromId")
    actual_carried = (
        str(task.carried_from_id) if task.carried_from_id is not None else None
    )
    return (
        task.description != expected["description"]
        or task.task_date.isoformat() != expected["taskDate"]
        or task.status != expected["status"]
        or (task.resource_url or None) != (expected.get("resourceUrl") or None)
        or str(task.phase_id) != str(expected.get("phaseId") or task.phase_id)
        or (task.week_label or "") != (expected.get("weekLabel") or "")
        or actual_carried != expected_carried
        or (
            "estimatedMinutes" in expected
            and task.estimated_minutes != expected.get("estimatedMinutes")
        )
    )


def _phase_changed_from_expected(phase: Phase | None, expected: dict) -> bool:
    if phase is None:
        return True
    return (
        phase.name != expected.get("name")
        or phase.phase_index != expected.get("phaseIndex")
        or phase.start_date.isoformat() != expected.get("startDate")
        or phase.end_date.isoformat() != expected.get("endDate")
        or int(phase.progress_percent) != int(expected.get("progressPercent") or 0)
        or bool(phase.is_current) != bool(expected.get("isCurrent"))
        or bool(phase.is_completed) != bool(expected.get("isCompleted"))
    )


def _assert_undo_still_safe(
    session: Session, plan: Plan, row: PlanAdjustment, today: date
) -> None:
    """Reject undo when plan, created tasks/phases, or answers no longer match."""
    record = row.applied_record or {}
    plan_after = record.get("plan_after") or {}
    for attr, key in (
        ("goal_name", "goalName"),
        ("current_level", "currentLevel"),
        ("daily_minutes", "dailyMinutes"),
        ("total_phases", "totalPhases"),
    ):
        if key in plan_after and getattr(plan, attr) != plan_after[key]:
            raise AdjustmentConflictError("计划约束已被后续修改，不能撤销")
    if "goalDate" in plan_after and plan.goal_date.isoformat() != plan_after["goalDate"]:
        raise AdjustmentConflictError("计划约束已被后续修改，不能撤销")
    if "startDate" in plan_after and plan.start_date.isoformat() != plan_after["startDate"]:
        raise AdjustmentConflictError("计划约束已被后续修改，不能撤销")

    for task_id, expected in (record.get("after_created") or {}).items():
        task = session.get(DailyTask, uuid.UUID(task_id))
        if task is None:
            raise AdjustmentConflictError("调整写入的任务已不存在，不能撤销")
        if task_service.task_is_protected(task, today) and task.status == "pending":
            raise AdjustmentConflictError("任务已进入受保护历史，不能撤销")
        if task.status in ("done", "carried"):
            raise AdjustmentConflictError("任务已完成或顺延，不能撤销")
        if _task_changed_from_expected(task, expected):
            raise AdjustmentConflictError("任务已被后续修改，不能撤销")
        linked = list(
            session.scalars(
                select(PracticeQuestion).where(
                    PracticeQuestion.source_task_id == uuid.UUID(task_id)
                )
            )
        )
        if any(_practice_is_answered(item) for item in linked):
            raise AdjustmentConflictError("任务已有作答反馈，不能撤销")

    after_phases = record.get("after_phases") or {}
    for phase_id in record.get("created_phase_ids") or []:
        phase = session.get(Phase, uuid.UUID(phase_id))
        if phase is None:
            raise AdjustmentConflictError("调整写入的阶段已不存在，不能撤销")
        expected_phase = after_phases.get(phase_id)
        if expected_phase is None:
            raise AdjustmentConflictError("缺少阶段快照，不能安全撤销")
        if _phase_changed_from_expected(phase, expected_phase):
            raise AdjustmentConflictError("阶段已被后续修改，不能撤销")
        extra = [
            task
            for task in session.scalars(
                select(DailyTask).where(DailyTask.phase_id == phase.id)
            )
            if str(task.id) not in (record.get("created_ids") or [])
        ]
        if extra:
            raise AdjustmentConflictError("阶段仍有后续任务，不能撤销")


def undo_latest(
    session: Session,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
) -> PlanAdjustment:
    planner_service._owned_plan(session, user_id, plan_id)
    row = session.scalar(
        select(PlanAdjustment)
        .where(
            PlanAdjustment.plan_id == plan_id,
            PlanAdjustment.user_id == user_id,
            PlanAdjustment.status.in_(("confirmed", "undone")),
        )
        .order_by(PlanAdjustment.updated_at.desc(), PlanAdjustment.created_at.desc())
        .limit(1)
    )
    if row is None:
        raise AdjustmentNotFoundError("没有可撤销的已生效调整")
    if row.status == "undone":
        return row
    if row.status != "confirmed" or not row.applied_record:
        raise AdjustmentConflictError("没有可撤销的已生效调整")

    record = row.applied_record
    adjustment_id = row.id
    today = local_today()
    plan = session.get(Plan, plan_id)
    assert plan is not None
    _assert_undo_still_safe(session, plan, row, today)

    # Close the read snapshot. The claim UPDATE itself reserves the write
    # transaction; validation after that must stay in the same transaction.
    session.rollback()
    claimed = session.execute(
        update(PlanAdjustment)
        .where(
            PlanAdjustment.id == adjustment_id,
            PlanAdjustment.status == "confirmed",
        )
        .values(status="undone")
    )
    if claimed.rowcount != 1:
        session.rollback()
        fresh = session.get(PlanAdjustment, adjustment_id)
        if fresh is not None and fresh.status == "undone":
            return fresh
        raise AdjustmentConflictError("撤销未能取得该调整")

    session.expire_all()
    plan = session.get(Plan, plan_id)
    row = session.get(PlanAdjustment, adjustment_id)
    assert plan is not None and row is not None
    record = row.applied_record or {}
    before = record["before"]

    try:
        _assert_undo_still_safe(session, plan, row, local_today())
        for task_id in record.get("created_ids") or []:
            task = session.get(DailyTask, uuid.UUID(task_id))
            if task is not None:
                session.delete(task)
        session.flush()

        for phase_id in record.get("created_phase_ids") or []:
            phase = session.get(Phase, uuid.UUID(phase_id))
            if phase is not None:
                session.delete(phase)
        session.flush()

        existing_phases = {
            str(phase.id): phase
            for phase in session.scalars(select(Phase).where(Phase.plan_id == plan.id))
        }
        for phase_item in before["phases"]:
            if phase_item["id"] in existing_phases:
                continue
            phase = Phase(
                id=uuid.UUID(phase_item["id"]),
                plan_id=plan.id,
                phase_index=phase_item["phaseIndex"],
                name=phase_item["name"],
                start_date=date.fromisoformat(phase_item["startDate"]),
                end_date=date.fromisoformat(phase_item["endDate"]),
                progress_percent=phase_item.get("progressPercent", 0),
                is_current=bool(phase_item.get("isCurrent")),
                is_completed=bool(phase_item.get("isCompleted")),
            )
            session.add(phase)
            existing_phases[phase_item["id"]] = phase
        session.flush()

        for task_item in before["dailyTasks"]:
            if task_item["id"] not in (record.get("removed_ids") or []):
                continue
            existing = session.get(DailyTask, uuid.UUID(task_item["id"]))
            if existing is not None:
                continue
            phase_key = task_item["phaseId"]
            if phase_key not in existing_phases:
                continue
            session.add(
                DailyTask(
                    id=uuid.UUID(task_item["id"]),
                    plan_id=plan.id,
                    phase_id=uuid.UUID(phase_key),
                    task_date=date.fromisoformat(task_item["taskDate"]),
                    week_label=task_item["weekLabel"],
                    description=task_item["description"],
                    status=task_item["status"],
                    resource_url=task_item.get("resourceUrl"),
                    estimated_minutes=task_item["estimatedMinutes"]
                    if "estimatedMinutes" in task_item
                    else None,
                    carried_from_id=uuid.UUID(task_item["carriedFromId"])
                    if task_item.get("carriedFromId")
                    else None,
                )
            )
        session.flush()

        for attr, change in (record.get("plan_field_changes") or {}).items():
            before_val = change["before"]
            if attr in ("goal_date", "start_date"):
                setattr(plan, attr, date.fromisoformat(str(before_val)))
            else:
                setattr(plan, attr, before_val)
        plan.total_phases = int(before["plan"]["totalPhases"])

        row.steps = list(row.steps or []) + [{"step": "undo", "result": "ok"}]
        row.decision_summary = "已撤销最近一次确认的调整，相关未受保护任务已恢复。"
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(row)
    return row


def adjustment_to_api(row: PlanAdjustment) -> dict:
    return _public_adjustment(row)
