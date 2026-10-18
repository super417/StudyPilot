"""Deterministic reinforce tasks from wrong/partial evidence. No model call.

Preview writes only a ``PlanAdjustment``. Confirm inserts ``DailyTask`` rows
and ``ReinforceTaskEvidence`` links; undo deletes both in one transaction.
Separate from ``remedy_service`` by name and kind.
"""

from __future__ import annotations

import re
import uuid
from datetime import date, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.clock import local_today
from app.models.entities import (
    DailyTask,
    MasteryEvidence,
    Phase,
    Plan,
    PlanAdjustment,
    PracticeQuestion,
    ReinforceTaskEvidence,
    UserDocument,
    utc_now,
)
from app.services import adjustment_service, planner_service, weekly_review_service
from app.services.adjustment_service import (
    AdjustmentConflictError,
    AdjustmentNotFoundError,
)
from app.services.divergence import DIVERGENCE_THRESHOLD
from app.services.weekly_review_service import _EVIDENCE_SCORE, _evidence_day


def _score_bucket(rows: list[MasteryEvidence]) -> dict:
    if not rows:
        return {"percent": None, "evidenceCount": 0}
    percent = round(sum(_EVIDENCE_SCORE.get(row.result, 0) for row in rows) / len(rows))
    return {"percent": max(0, min(100, percent)), "evidenceCount": len(rows)}


class ReinforceOutcomeInconsistencyError(RuntimeError):
    """before + after counts do not cover the overall set; stop rather than invent."""


def _reread_description(session: Session, user_id: uuid.UUID, source_ref: str) -> str:
    """Human-readable reread task text; keep raw ref when the document is gone."""
    if "#" not in source_ref:
        return f"重读判分原文：{source_ref}（来源不可用）"
    doc_id, _, index_text = source_ref.partition("#")
    try:
        chunk_index = int(index_text)
    except ValueError:
        return f"重读判分原文：{source_ref}（来源不可用）"
    filename = session.scalar(
        select(UserDocument.filename).where(
            UserDocument.user_id == user_id,
            UserDocument.doc_id == doc_id,
        )
    )
    if not filename:
        return f"重读判分原文：{source_ref}（来源不可用）"
    return f"重读判分原文：{filename} · 第 {chunk_index + 1} 段"


def phase_reinforce_outcome(
    session: Session, user_id: uuid.UUID, phase_id: uuid.UUID
) -> dict:
    """Before/after mastery for one phase, split by reinforce_task_evidence.

    Full-history read: no week window. before = evidence whose source task is
    not a reinforce task; after = evidence whose source task is linked in
    reinforce_task_evidence. Path: question_id → PracticeQuestion.source_task_id.

    ``overall`` is the same formula over before∪after (not a juxtaposed after%).
    """
    phase = session.scalar(
        select(Phase)
        .join(Plan, Plan.id == Phase.plan_id)
        .where(Phase.id == phase_id, Plan.user_id == user_id)
    )
    if phase is None:
        raise AdjustmentNotFoundError("阶段不存在")
    reinforce_task_ids = set(
        session.scalars(
            select(ReinforceTaskEvidence.task_id)
            .join(DailyTask, DailyTask.id == ReinforceTaskEvidence.task_id)
            .where(DailyTask.phase_id == phase_id)
        )
    )
    evidence_rows = list(
        session.scalars(
            select(MasteryEvidence).where(
                MasteryEvidence.user_id == user_id,
                MasteryEvidence.knowledge_point == phase_id,
            )
        )
    )
    before_rows: list[MasteryEvidence] = []
    after_rows: list[MasteryEvidence] = []
    for row in evidence_rows:
        if row.knowledge_point is None:
            continue
        source_task_id: uuid.UUID | None = None
        if row.question_id is not None:
            question = session.get(PracticeQuestion, row.question_id)
            if question is not None:
                source_task_id = question.source_task_id
        if source_task_id is not None and source_task_id in reinforce_task_ids:
            after_rows.append(row)
        else:
            before_rows.append(row)
    overall_rows = before_rows + after_rows
    before = _score_bucket(before_rows)
    after = _score_bucket(after_rows)
    after["correctCount"] = sum(1 for row in after_rows if row.result == "correct")
    overall = _score_bucket(overall_rows)
    # Every evidence row must land in exactly one bucket. Comparing against the
    # bucket sum would be tautological (both sides come from the same lists);
    # comparing against the fetched rows is what catches a future third bucket
    # or an early ``continue`` silently dropping rows.
    if overall["evidenceCount"] != len(evidence_rows):
        raise ReinforceOutcomeInconsistencyError(
            "有证据未进入 before/after 任何一桶"
        )
    return {
        "phaseId": str(phase_id),
        "overall": overall,
        "before": before,
        "after": after,
    }


def list_reinforce_outcomes(session: Session, user_id: uuid.UUID) -> list[dict]:
    """Outcomes only for phases that currently have reinforce tasks."""
    phase_ids = list(
        session.scalars(
            select(DailyTask.phase_id)
            .join(ReinforceTaskEvidence, ReinforceTaskEvidence.task_id == DailyTask.id)
            .join(Plan, Plan.id == DailyTask.plan_id)
            .where(Plan.user_id == user_id)
            .distinct()
        )
    )
    return [
        phase_reinforce_outcome(session, user_id, phase_id) for phase_id in phase_ids
    ]


def _supersede_pending_reinforce(
    session: Session, plan_id: uuid.UUID
) -> None:
    """Invalidate prior pending reinforce previews so they stop blocking evidence.

    Status CHECK only allows pending/confirmed/rejected/conflict/undone — use
    ``rejected`` (no ``superseded`` value). Does not touch remedy or other kinds.
    """
    stale = session.scalars(
        select(PlanAdjustment).where(
            PlanAdjustment.plan_id == plan_id,
            PlanAdjustment.status == "pending",
        )
    )
    for adj in stale:
        if (adj.proposal or {}).get("kind") == "reinforce":
            adj.status = "rejected"
            adj.steps = list(adj.steps or []) + [
                {"step": "supersede", "result": "ok", "reason": "replaced_by_new_preview"}
            ]


def create_reinforce_preview(
    session: Session,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    *,
    today: date | None = None,
) -> PlanAdjustment:
    plan = planner_service._owned_plan(session, user_id, plan_id)
    day = today or local_today()
    week_start, week_end = weekly_review_service.week_bounds(day)
    # Release evidence held by abandoned pending reinforce previews first.
    _supersede_pending_reinforce(session, plan.id)
    session.flush()  # so _blocked_evidence_ids in _build sees rejected, not stale pending
    built = _build(session, user_id, plan, week_start, week_end, day)
    row = PlanAdjustment(
        user_id=user_id,
        plan_id=plan.id,
        status="pending",
        instruction="根据背离与错题生成补强任务",
        basis_fingerprint=adjustment_service.basis_fingerprint(session, plan),
        proposal=built["proposal"],
        diff=built["diff"],
        validation=built["validation"],
        steps=built["steps"],
        decision_summary=built["summary"],
        evidence_refs=built["evidence"],
    )
    session.add(row)
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(row)
    return row


def confirm_reinforce(
    session: Session,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    adjustment_id: uuid.UUID,
    expected_selection_version: int | None = None,
) -> PlanAdjustment:
    session.expire_all()
    plan = planner_service._owned_plan(session, user_id, plan_id)
    row = adjustment_service.get_adjustment(session, user_id, plan_id, adjustment_id)
    if row.status == "confirmed":
        return row
    if row.status != "pending" or (row.proposal or {}).get("kind") != "reinforce":
        raise AdjustmentConflictError("该预览不能确认")
    if expected_selection_version is None:
        raise AdjustmentConflictError("请提交已查看的选择版本后再确认，或重新生成预览")
    if not (row.validation or {}).get("ok", False):
        raise AdjustmentConflictError("预览未通过校验，不能确认")
    stored_version = adjustment_service._selection_version(row.proposal)
    if stored_version is None or expected_selection_version != stored_version:
        raise AdjustmentConflictError("预览选择已更新，请查看重新计算后的结果再确认")
    current_fp = adjustment_service.basis_fingerprint(session, plan)
    if current_fp != row.basis_fingerprint:
        return adjustment_service._confirm_or_conflict(
            session, row, "basis_changed", "规划或任务已变化，请重新生成预览"
        )
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
    session.expire_all()
    plan = planner_service._owned_plan(session, user_id, plan_id)
    row = session.get(PlanAdjustment, adjustment_id)
    assert row is not None
    if adjustment_service.basis_fingerprint(session, plan) != row.basis_fingerprint:
        return adjustment_service._confirm_or_conflict(
            session, row, "basis_changed", "规划或任务已变化，请重新生成预览"
        )
    try:
        _apply_reinforce(session, plan, row)
        session.commit()
    except AdjustmentConflictError:
        return adjustment_service._confirm_or_conflict(
            session, row, "reinforce_apply_conflict", "补强任务无法写入，请重新生成预览"
        )
    except Exception:
        session.rollback()
        raise
    session.refresh(row)
    return row


def undo_reinforce(
    session: Session, user_id: uuid.UUID, plan_id: uuid.UUID
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
    if row is None or not row.applied_record or row.applied_record.get("kind") != "reinforce":
        raise AdjustmentNotFoundError("没有可撤销的已生效调整")
    if row.status == "undone":
        return row
    adjustment_id = row.id
    record = row.applied_record or {}
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
    row = session.get(PlanAdjustment, adjustment_id)
    assert row is not None
    record = row.applied_record or {}
    try:
        task_ids = [
            uuid.UUID(task_id) for task_id in (record.get("createdTaskIds") or [])
        ]
        if task_ids:
            session.execute(
                delete(ReinforceTaskEvidence).where(
                    ReinforceTaskEvidence.task_id.in_(task_ids)
                )
            )
            for task_id in task_ids:
                task = session.get(DailyTask, task_id)
                if task is not None:
                    session.delete(task)
        session.flush()
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(row)
    return row


def _build(
    session: Session,
    user_id: uuid.UUID,
    plan: Plan,
    week_start: date,
    week_end: date,
    today: date,
) -> dict:
    _avg, detail = weekly_review_service.phase_mastery(
        session, user_id, week_start, week_end
    )
    tasks: list[dict] = []
    evidence_refs: list[dict] = []
    seen_evidence: set[str] = set()
    # 重读按 source_ref 去重；重做按 question_id 去重（同一题多次答错只出一条）
    seen_reread_refs: set[str] = set()
    seen_redo_questions: set[str] = set()
    blocked = _blocked_evidence_ids(session, plan.id)

    for item in detail:
        completion = item.get("completionRate")
        percent = item.get("percent")
        phase_id_raw = item.get("phaseId")
        if completion is None or percent is None or not phase_id_raw:
            continue
        if completion - percent < DIVERGENCE_THRESHOLD:
            continue
        phase_id = uuid.UUID(str(phase_id_raw))
        errors = _error_evidence(session, user_id, phase_id, week_start, week_end)
        if not errors:
            continue
        phase = session.get(Phase, phase_id)
        if phase is None or phase.plan_id != plan.id:
            continue
        for row in errors:
            if row.id in blocked:
                continue
            evidence_id = str(row.id)
            if evidence_id not in seen_evidence:
                seen_evidence.add(evidence_id)
                evidence_refs.append(
                    {
                        "kind": "mastery_evidence",
                        "evidenceId": evidence_id,
                        "phaseId": str(phase_id),
                        "questionId": str(row.question_id) if row.question_id else None,
                        "sourceRef": row.source_ref,
                        "result": row.result,
                    }
                )
            # 重做：有 question_id 时整预览只保留第一次；无 question_id 则按证据各出一条
            qid = str(row.question_id) if row.question_id else None
            if qid is None or qid not in seen_redo_questions:
                if qid is not None:
                    seen_redo_questions.add(qid)
                question_text = _question_text(session, row)
                tasks.append(
                    {
                        "actionId": f"redo-{evidence_id}",
                        "kind": "redo",
                        "phaseId": str(phase_id),
                        "phaseName": phase.name,
                        "taskDate": today.isoformat(),
                        "description": f"重做错题：{question_text}",
                        "status": "pending",
                        "estimatedMinutes": None,
                        "evidenceId": evidence_id,
                        "questionId": qid,
                        "sourceRef": None,
                    }
                )
            # 重读与重做独立去重：跳过重做时仍可能生成重读
            if row.source_ref and row.source_ref not in seen_reread_refs:
                seen_reread_refs.add(row.source_ref)
                tasks.append(
                    {
                        "actionId": f"reread-{evidence_id}",
                        "kind": "reread",
                        "phaseId": str(phase_id),
                        "phaseName": phase.name,
                        "taskDate": today.isoformat(),
                        "description": _reread_description(
                            session, user_id, row.source_ref
                        ),
                        "status": "pending",
                        "estimatedMinutes": None,
                        "evidenceId": evidence_id,
                        "questionId": str(row.question_id) if row.question_id else None,
                        "sourceRef": row.source_ref,
                    }
                )

    ok = len(tasks) > 0
    validation = {
        "ok": ok,
        "contract": "reinforce",
        "checks": {"divergence": "pass" if ok else "fail"},
    }
    summary = (
        f"补强预览：提出 {len(tasks)} 条任务，依据 {len(evidence_refs)} 条错题证据。"
        "尚未写入规划。"
        if ok
        else "补强预览：没有同时满足背离与错误证据的阶段，未提出任务。"
    )
    proposal = {
        "kind": "reinforce",
        "calendarDay": today.isoformat(),
        "weekStart": week_start.isoformat(),
        "weekEnd": week_end.isoformat(),
        "selectionVersion": 1,
        "tasks": tasks,
        "threshold": DIVERGENCE_THRESHOLD,
    }
    diff = {
        "removedOrReplaced": [],
        "proposedPending": [
            {
                "actionId": item["actionId"],
                "taskDate": item["taskDate"],
                "description": item["description"],
                "status": "pending",
                "estimatedMinutes": item["estimatedMinutes"],
                "phaseName": item["phaseName"],
            }
            for item in tasks
        ],
        "protectedKept": 0,
        "planChanges": [],
        "reinforce": {"taskCount": len(tasks), "evidenceCount": len(evidence_refs)},
    }
    steps = [
        {"step": "scan_divergence", "result": "ok" if ok else "empty"},
        {"step": "build_tasks", "result": "ok", "count": len(tasks)},
    ]
    return {
        "proposal": proposal,
        "diff": diff,
        "validation": validation,
        "steps": steps,
        "summary": summary,
        "evidence": evidence_refs,
    }


def _error_evidence(
    session: Session,
    user_id: uuid.UUID,
    phase_id: uuid.UUID,
    week_start: date,
    week_end: date,
) -> list[MasteryEvidence]:
    rows = list(
        session.scalars(
            select(MasteryEvidence).where(
                MasteryEvidence.user_id == user_id,
                MasteryEvidence.knowledge_point == phase_id,
                MasteryEvidence.result.in_(("wrong", "partial")),
            )
        )
    )
    matched: list[MasteryEvidence] = []
    for row in rows:
        day = _evidence_day(row.created_at)
        if day is None or day < week_start or day > week_end:
            continue
        matched.append(row)
    return matched


def _covered_evidence_ids(session: Session, plan_id: uuid.UUID) -> set[uuid.UUID]:
    """Evidence already linked to a reinforce task for this plan (table is source of truth)."""
    return set(
        session.scalars(
            select(ReinforceTaskEvidence.evidence_id)
            .join(DailyTask, DailyTask.id == ReinforceTaskEvidence.task_id)
            .where(DailyTask.plan_id == plan_id)
        )
    )


def _blocked_evidence_ids(session: Session, plan_id: uuid.UUID) -> set[uuid.UUID]:
    """Skip evidence already reinforced (table) or reserved by a pending reinforce preview.

    Only pending reinforce previews created within the last 24 hours reserve
    evidence — older leftovers must not permanently block new previews.
    """
    blocked = _covered_evidence_ids(session, plan_id)
    # 24h：避免历史遗留 pending 预览永久占用证据
    cutoff = utc_now() - timedelta(hours=24)
    pending = session.scalars(
        select(PlanAdjustment).where(
            PlanAdjustment.plan_id == plan_id,
            PlanAdjustment.status == "pending",
            PlanAdjustment.created_at >= cutoff,
        )
    )
    for adjustment in pending:
        if (adjustment.proposal or {}).get("kind") != "reinforce":
            continue
        for item in (adjustment.proposal or {}).get("tasks") or []:
            raw = item.get("evidenceId")
            if raw:
                blocked.add(uuid.UUID(str(raw)))
    return blocked


def _clean_question_text(text: str) -> str:
    """Strip markdown emphasis markers that leak from generated questions."""
    cleaned = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    cleaned = re.sub(r"\*(.+?)\*", r"\1", cleaned)
    cleaned = re.sub(r"^[#>\-\*\s]+", "", cleaned)
    return cleaned.strip()


def _question_text(session: Session, evidence: MasteryEvidence) -> str:
    if evidence.question_id is None:
        return "（无题目原文）"
    question = session.get(PracticeQuestion, evidence.question_id)
    if question is None or not (question.question or "").strip():
        return "（无题目原文）"
    return _clean_question_text(question.question.strip())


def _apply_reinforce(session: Session, plan: Plan, row: PlanAdjustment) -> None:
    proposal = row.proposal or {}
    tasks = list(proposal.get("tasks") or [])
    if not tasks:
        raise AdjustmentConflictError("预览没有可写入的补强任务")
    already = _covered_evidence_ids(session, plan.id)
    created_ids: list[str] = []
    created_copies: list[dict] = []
    for item in tasks:
        evidence_raw = item.get("evidenceId")
        if not evidence_raw:
            raise AdjustmentConflictError("补强任务缺少证据")
        evidence_id = uuid.UUID(str(evidence_raw))
        # Intentional idempotency: this evidence already has reinforce task(s),
        # so skip it and keep writing the rest. Only when every item is skipped
        # does the AdjustmentConflictError below reject an empty apply.
        if evidence_id in already:
            continue
        phase_id = uuid.UUID(str(item["phaseId"]))
        phase = session.get(Phase, phase_id)
        if phase is None or phase.plan_id != plan.id:
            raise AdjustmentConflictError("补强任务的阶段已不存在")
        if item.get("kind") == "reread":
            source_ref = item.get("sourceRef")
            if not source_ref:
                raise AdjustmentConflictError("重读任务缺少出处")
            evidence = session.get(MasteryEvidence, evidence_id)
            if evidence is None or evidence.source_ref != source_ref:
                raise AdjustmentConflictError("重读出处无法在判分记录中核对")
        task_date = date.fromisoformat(str(item["taskDate"]))
        week_label = f"W{task_date.isocalendar().week:02d}"
        task = DailyTask(
            plan_id=plan.id,
            phase_id=phase_id,
            task_date=task_date,
            week_label=week_label,
            description=str(item["description"]),
            status="pending",
            estimated_minutes=item.get("estimatedMinutes"),
        )
        session.add(task)
        session.flush()
        session.add(
            ReinforceTaskEvidence(task_id=task.id, evidence_id=evidence_id)
        )
        created_ids.append(str(task.id))
        created_copies.append(
            {
                "id": str(task.id),
                "phaseId": str(phase_id),
                "taskDate": task_date.isoformat(),
                "description": task.description,
                "kind": item.get("kind"),
                "evidenceId": str(evidence_id),
                "sourceRef": item.get("sourceRef"),
                "questionId": item.get("questionId"),
            }
        )
    if not created_ids:
        raise AdjustmentConflictError("这些证据已有补强任务，请重新生成预览")
    row.applied_record = {
        "kind": "reinforce",
        "createdTaskIds": created_ids,
        "createdCopies": created_copies,
    }
    row.steps = list(row.steps or []) + [{"step": "confirm", "result": "applied"}]
    row.decision_summary = (
        f"已确认补强：新增 {len(created_ids)} 条任务，已写入今日任务。\n"
        "下一步：\n"
        "1. 在「触发补强」卡片里点对应阶段的「重测」，开始本阶段的重测题\n"
        "2. 做完后到「阶段双环」看「补强前/后」的掌握度变化"
    )
