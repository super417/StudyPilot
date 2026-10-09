"""Persistent plan-adjustment preview, confirm, reject, and undo."""

from __future__ import annotations

from datetime import date
import copy
import hashlib
import json
import uuid
from collections.abc import Callable

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.clock import local_today
from app.models.entities import DailyTask, Phase, Plan, PlanAdjustment, PracticeQuestion
from app.services import document_service, planner_service, resource_links, task_service
from app.services.api_config_service import require_verified_api_config
from app.services.planner_service import PlanGenerator, PlanGenerationError

# Test-only seams for controllable interleaving (independent connections).
# after_fingerprint: after basis read / before claim+write.
# after_claim: after claim UPDATE, before plan/task writes (may block on SQLite).
_confirm_after_fingerprint_hook: Callable[[Session, PlanAdjustment], None] | None = None
_confirm_between_claim_and_apply: Callable[[Session, PlanAdjustment], None] | None = None


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
            }
            for task in tasks
        ],
    }


def _exact_apply_phases(
    phases_data: list[dict], today: date, goal: date
) -> list[dict]:
    """Normalize phases for preview==confirm.

    May slide an all-past schedule onto today (shown in the preview diff).
    Never invents gap-fill tasks.
    """
    working = [dict(phase) if isinstance(phase, dict) else phase for phase in phases_data]
    for phase in working:
        if isinstance(phase, dict) and isinstance(phase.get("daily_tasks"), list):
            phase["daily_tasks"] = [
                dict(task) if isinstance(task, dict) else task
                for task in phase["daily_tasks"]
            ]
    planner_service._anchor_schedule(working, today, goal)
    prepared: list[dict] = []
    for phase in working:
        if not isinstance(phase, dict):
            raise PlanGenerationError("阶段结构无效，无法生成预览")
        phase_start = planner_service._coerce_date(phase.get("start_date"), today)
        phase_end = planner_service._coerce_date(phase.get("end_date"), phase_start)
        tasks_out: list[dict] = []
        for task in phase.get("daily_tasks") or []:
            if not isinstance(task, dict):
                raise PlanGenerationError("任务结构无效，无法生成预览")
            task_date = planner_service._coerce_date(task.get("task_date"), phase_start)
            if task_date < today:
                continue
            description = str(task.get("description", "")).strip()
            if not description:
                raise PlanGenerationError("任务描述为空，无法生成预览")
            tasks_out.append(
                {
                    "task_date": task_date.isoformat(),
                    "week_label": str(task.get("week_label") or ""),
                    "description": description,
                    "resource_url": resource_links.sanitize_resource_url(
                        task.get("resource_url")
                    ),
                }
            )
        if not tasks_out:
            raise PlanGenerationError(
                "阶段缺少可执行的每日任务，无法生成预览（不会静默补任务）"
            )
        prepared.append(
            {
                "name": str(phase.get("name") or "阶段"),
                "start_date": phase_start.isoformat(),
                "end_date": phase_end.isoformat(),
                "daily_tasks": tasks_out,
            }
        )
    return prepared


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
            "taskDate": task.task_date.isoformat(),
            "description": task.description,
            "status": task.status,
        }
        for task in current
        if not _kept(task)
    ]
    proposed = [
        {
            "taskDate": task["task_date"],
            "description": task["description"],
            "status": "pending",
        }
        for phase in apply_phases
        for task in phase["daily_tasks"]
    ]
    return {
        "removedOrReplaced": removable,
        "proposedPending": proposed,
        "protectedKept": sum(1 for task in current if _kept(task)),
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
            )
            for item in (diff.get("removedOrReplaced") or [])
        ),
        "proposed": sorted(
            (
                item["taskDate"],
                item["description"],
                item.get("status") or "pending",
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
    apply_phases: list[dict], skipped_docs: list[str]
) -> dict:
    """Deterministic checks for this batch. Unimplemented items stay unverified."""
    task_count = sum(len(phase["daily_tasks"]) for phase in apply_phases)
    structure_ok = len(apply_phases) >= 2 and task_count > 0
    checks = {
        "structure": "pass" if structure_ok else "fail",
        "protectedTaskRule": "pass",
        "evidenceLocation": "unverified",
        "duration": "unverified",
    }
    return {
        "ok": structure_ok,
        "checks": checks,
        "protectedTaskRule": "keep_done_carried_past",
        "skippedDocs": skipped_docs,
        "evidenceTimeChecks": "unverified",
    }


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

    used_docs, skipped_docs = document_service.filter_ready_documents(
        session, user_id, document_ids
    )
    context_text = document_service.retrieve_document_chunks(
        session, user_id, used_docs
    )
    generator = planner_service._resolve_plan_generator(
        session, user_id, plan_generator
    )
    structure = await planner_service._run_generator(
        generator, fields, used_docs, context_text, instruction
    )
    phases_data = planner_service._validate_structure(structure)
    today = local_today()
    apply_phases = _exact_apply_phases(phases_data, today, plan.goal_date)
    fingerprint = basis_fingerprint(session, plan)
    diff = _build_diff(session, plan, today, apply_phases)
    validation = _run_code_checks(apply_phases, skipped_docs)
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
    if not validation["ok"]:
        raise PlanGenerationError("结构调整未通过校验，无法生成预览")
    summary = (
        f"预览：将替换 {len(diff['removedOrReplaced'])} 条未受保护任务，"
        f"提出 {len(diff['proposedPending'])} 条新安排，"
        f"保留 {diff['protectedKept']} 条历史任务。尚未写入规划。"
    )
    row = PlanAdjustment(
        user_id=user_id,
        plan_id=plan.id,
        status="pending",
        instruction=instruction,
        basis_fingerprint=fingerprint,
        proposal={
            "fields": fields,
            "phases": apply_phases,
            "usedDocs": used_docs,
            "skippedDocs": skipped_docs,
        },
        diff=diff,
        validation=validation,
        steps=steps,
        decision_summary=summary,
        evidence_refs=[],
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


def _practice_is_answered(row: PracticeQuestion) -> bool:
    """User feedback uses status; ``answer`` is the reference key, not submission."""
    return task_service.practice_is_answered(row.status)


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
    if not (row.validation or {}).get("ok", False):
        raise AdjustmentConflictError("预览未通过校验，不能确认")

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

    recheck = _run_code_checks(
        apply_phases, list(row.proposal.get("skippedDocs") or [])
    )
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
        if basis_fingerprint(session, live_plan) != live_row.basis_fingerprint:
            raise AdjustmentConflictError("规划或任务已变化，请重新生成预览")
        _ensure_confirm_applicable(
            session, live_plan, live_row, local_today(), apply_phases
        )

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
        ("goalDate", "goal_date", lambda v: planner_service._coerce_date(v, plan.goal_date)),
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

    # End the read snapshot so another connection's commit is visible,
    # then re-check before the confirmed→undone claim. This dialect rejects
    # isolation_level=IMMEDIATE, so the fresh transaction is the reliable step.
    session.rollback()
    plan = session.get(Plan, plan_id)
    row = session.get(PlanAdjustment, adjustment_id)
    assert plan is not None and row is not None
    if row.status == "undone":
        return row
    if row.status != "confirmed" or not row.applied_record:
        raise AdjustmentConflictError("没有可撤销的已生效调整")
    record = row.applied_record
    today = local_today()
    try:
        _assert_undo_still_safe(session, plan, row, today)
    except AdjustmentConflictError:
        session.rollback()
        raise

    claimed = session.execute(
        update(PlanAdjustment)
        .where(
            PlanAdjustment.id == row.id,
            PlanAdjustment.status == "confirmed",
        )
        .values(status="undone")
    )
    if claimed.rowcount != 1:
        session.rollback()
        fresh = session.get(PlanAdjustment, row.id)
        if fresh is not None and fresh.status == "undone":
            return fresh
        raise AdjustmentConflictError("撤销未能取得该调整")

    session.refresh(row)
    before = record["before"]

    try:
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
