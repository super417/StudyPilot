"""Confirmable catch-up choices. Code places the work; no model call.

A remedy preview does not rewrite the rest of the plan. Confirmation marks
only the chosen source rows carried and adds one pending copy each.
"""

from __future__ import annotations

from datetime import date, timedelta
import uuid

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.clock import local_today
from app.models.entities import CheckIn, DailyTask, Phase, Plan, PlanAdjustment, PracticeQuestion
from app.services import adjustment_service, planner_service, task_service
from app.services.adjustment_service import (
    AdjustmentConflictError,
    AdjustmentNotFoundError,
)
from app.services.planner_service import PlanGenerationError

_OPTIONS = ("spread", "reduce", "extend")
_OPTION_LABELS = {
    "spread": "分散补做",
    "reduce": "本次不补做",
    "extend": "延后截止",
}
_SEARCH_DAYS = 366


def create_remedy_preview(
    session: Session, user_id: uuid.UUID, plan_id: uuid.UUID
) -> PlanAdjustment:
    plan = planner_service._owned_plan(session, user_id, plan_id)
    today = local_today()
    candidates = _candidates(session, plan, today)
    if not candidates:
        raise AdjustmentConflictError("没有待补候选")
    built = _build(session, plan, user_id, today, candidates, "spread", [item["sourceId"] for item in candidates], {})
    row = PlanAdjustment(
        user_id=user_id,
        plan_id=plan.id,
        status="pending",
        instruction="安排未完成的任务",
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


def revise_remedy(
    session: Session,
    user_id: uuid.UUID,
    plan_id: uuid.UUID,
    adjustment_id: uuid.UUID,
    option_id: str,
    keep_source_ids: list[str],
    minute_overrides: dict[str, int] | None,
    selection_version: int,
) -> PlanAdjustment:
    plan = planner_service._owned_plan(session, user_id, plan_id)
    row = adjustment_service.get_adjustment(session, user_id, plan_id, adjustment_id)
    if row.status != "pending" or (row.proposal or {}).get("kind") != "remedy":
        raise AdjustmentConflictError("只有待确认的补救预览可以调整")
    stored_version = adjustment_service._selection_version(row.proposal)
    if stored_version is None or selection_version != stored_version:
        raise AdjustmentConflictError("预览选择版本已变化，请使用最新结果")
    if option_id not in _OPTIONS:
        raise AdjustmentConflictError("补救方案不存在")
    proposal = dict(row.proposal or {})
    known = {item["sourceId"] for item in proposal.get("candidates") or []}
    unknown = [item for item in keep_source_ids if item not in known]
    if unknown:
        raise AdjustmentConflictError("选择包含未知任务，请使用预览中的任务")
    saved = {
        str(key): value
        for key, value in dict(proposal.get("savedMinutes") or {}).items()
        if isinstance(value, int) and not isinstance(value, bool) and value > 0
    }
    for key, raw in (minute_overrides or {}).items():
        if isinstance(raw, bool) or not isinstance(raw, int) or raw <= 0:
            raise AdjustmentConflictError("预计分钟必须是正整数")
        if str(key) not in known:
            raise AdjustmentConflictError("选择包含未知任务，请使用预览中的任务")
        saved[str(key)] = raw
    today = local_today()
    if proposal.get("calendarDay") != today.isoformat():
        raise AdjustmentConflictError("已经跨日，请重新生成预览")
    built = _build(
        session,
        plan,
        user_id,
        today,
        list(proposal.get("candidates") or []),
        option_id,
        list(keep_source_ids),
        saved,
        version=stored_version + 1,
        check_ins=list(proposal.get("checkIns") or []),
    )
    if not _same_check_ins(session, user_id, today, list(proposal.get("checkIns") or [])):
        raise AdjustmentConflictError("打卡记录已变化，请重新生成预览")
    fingerprint = row.basis_fingerprint
    adjustment_id_value = row.id
    session.rollback()
    claimed = session.execute(
        update(PlanAdjustment)
        .where(
            PlanAdjustment.id == adjustment_id_value,
            PlanAdjustment.status == "pending",
            func.json_extract(PlanAdjustment.proposal, "$.selectionVersion") == stored_version,
        )
        .values(
            proposal=built["proposal"],
            diff=built["diff"],
            validation=built["validation"],
            evidence_refs=built["evidence"],
            steps=built["steps"],
            decision_summary=built["summary"],
        )
    )
    if claimed.rowcount != 1:
        session.rollback()
        raise AdjustmentConflictError("预览选择版本已变化，请使用最新结果")
    session.expire_all()
    fresh = session.get(PlanAdjustment, adjustment_id_value)
    if fresh is None or fresh.status != "pending":
        session.rollback()
        raise AdjustmentConflictError("预览选择版本已变化，请使用最新结果")
    live_plan = planner_service._owned_plan(session, user_id, plan_id)
    if adjustment_service.basis_fingerprint(session, live_plan) != fingerprint:
        session.rollback()
        raise AdjustmentConflictError("规划或任务已变化，请重新生成预览")
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(fresh)
    return fresh


def confirm_remedy(
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
    if row.status != "pending" or (row.proposal or {}).get("kind") != "remedy":
        raise AdjustmentConflictError("该预览不能确认")
    if expected_selection_version is None:
        raise AdjustmentConflictError("请提交已查看的选择版本后再确认，或重新生成预览")
    if not (row.validation or {}).get("ok", False):
        raise AdjustmentConflictError("预览未通过校验，不能确认")
    stored_version = adjustment_service._selection_version(row.proposal)
    if stored_version is None or expected_selection_version != stored_version:
        raise AdjustmentConflictError("预览选择已更新，请查看重新计算后的结果再确认")
    today = local_today()
    if not _confirm_still_matches(session, user_id, plan, row, today):
        return adjustment_service._confirm_or_conflict(
            session, row, "remedy_basis_changed", "打卡、日期或任务已变化，请重新生成预览"
        )
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
    if adjustment_service._selection_version(row.proposal) != expected_selection_version:
        return adjustment_service._confirm_or_conflict(
            session, row, "selection_changed", "预览选择已更新，请查看重新计算后的结果再确认"
        )
    if not _confirm_still_matches(session, user_id, plan, row, local_today()):
        return adjustment_service._confirm_or_conflict(
            session, row, "remedy_basis_changed", "打卡、日期或任务已变化，请重新生成预览"
        )
    try:
        _apply_remedy(session, plan, row)
        session.commit()
    except AdjustmentConflictError:
        return adjustment_service._confirm_or_conflict(
            session, row, "remedy_apply_conflict", "待补任务已变化，请重新生成预览"
        )
    except Exception:
        session.rollback()
        raise
    session.refresh(row)
    return row


def undo_remedy(
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
    if row is None or not row.applied_record or row.applied_record.get("kind") != "remedy":
        raise AdjustmentNotFoundError("没有可撤销的已生效调整")
    if row.status == "undone":
        return row
    adjustment_id = row.id
    _assert_remedy_undo_safe(session, row.applied_record)
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
    plan = session.get(Plan, plan_id)
    assert row is not None and plan is not None
    record = row.applied_record or {}
    try:
        _assert_remedy_undo_safe(session, record)
        for task_id in record.get("createdTaskIds") or []:
            task = session.get(DailyTask, uuid.UUID(task_id))
            if task is not None:
                session.delete(task)
        session.flush()
        for source_id, expected in (record.get("remedySources") or {}).items():
            source = session.get(DailyTask, uuid.UUID(source_id))
            if source is None:
                raise AdjustmentConflictError("原任务已不存在，不能撤销")
            source.status = expected.get("statusBefore") or "pending"
        _replay_changed_fields(session, plan, record)
        row.steps = list(row.steps or []) + [{"step": "undo", "result": "ok"}]
        row.decision_summary = "已撤销补救。原任务回到未标记完成，本次副本已删除，打卡仍保留。"
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(row)
    return row


def _candidates(session: Session, plan: Plan, today: date) -> list[dict]:
    tasks = list(
        session.scalars(select(DailyTask).where(DailyTask.plan_id == plan.id))
    )
    answered = task_service.answered_practice_task_ids(session, plan.id)
    active_parents = {
        task.carried_from_id
        for task in tasks
        if task.status == "pending" and task.carried_from_id is not None
    }
    phases = {
        phase.id: phase
        for phase in session.scalars(select(Phase).where(Phase.plan_id == plan.id))
    }
    chosen: list[DailyTask] = []
    for task in tasks:
        if task.status != "pending" or task.task_date >= today:
            continue
        if task.task_date < plan.start_date or task.id in answered:
            continue
        if task.id in active_parents:
            continue
        chosen.append(task)
    chosen.sort(key=lambda task: (task.task_date, str(task.id)))
    rows: list[dict] = []
    for task in chosen:
        phase = phases.get(task.phase_id)
        rows.append(
            {
                "sourceId": str(task.id),
                "taskDate": task.task_date.isoformat(),
                "description": task.description,
                "estimatedMinutes": task.estimated_minutes,
                "phaseId": str(task.phase_id),
                "phaseEnd": phase.end_date.isoformat() if phase is not None else None,
                "phaseName": phase.name if phase is not None else "",
                "resourceUrl": task.resource_url,
            }
        )
    return rows


def _future_load(
    session: Session, plan: Plan, today: date
) -> tuple[dict[date, int], dict[date, int]]:
    loads: dict[date, int] = {}
    unknown: dict[date, int] = {}
    tasks = session.scalars(
        select(DailyTask).where(
            DailyTask.plan_id == plan.id,
            DailyTask.status == "pending",
            DailyTask.task_date > today,
        )
    )
    for task in tasks:
        if task.estimated_minutes is None:
            unknown[task.task_date] = unknown.get(task.task_date, 0) + 1
            continue
        loads[task.task_date] = loads.get(task.task_date, 0) + task.estimated_minutes
    return loads, unknown


def _minutes_for(candidate: dict, saved: dict[str, int]) -> int | None:
    if candidate["sourceId"] in saved:
        return saved[candidate["sourceId"]]
    value = candidate.get("estimatedMinutes")
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


def _place(
    candidates: list[dict],
    keep_ids: set[str],
    saved: dict[str, int],
    option: str,
    today: date,
    goal: date,
    cap: int,
    loads: dict[date, int],
    unknown_days: dict[date, int],
) -> tuple[list[dict], list[dict], str, bool, str]:
    selected = [item for item in candidates if item["sourceId"] in keep_ids]
    not_arranged = [
        {
            "sourceId": item["sourceId"],
            "description": item["description"],
            "reason": "本次不补做",
        }
        for item in candidates
        if item["sourceId"] not in keep_ids
    ]
    blocking = False
    usable: list[tuple[dict, int]] = []
    for item in selected:
        minutes = _minutes_for(item, saved)
        if minutes is None:
            blocking = True
            not_arranged.append(
                {
                    "sourceId": item["sourceId"],
                    "description": item["description"],
                    "reason": "预计分钟未知",
                }
            )
        elif minutes > cap:
            blocking = True
            not_arranged.append(
                {
                    "sourceId": item["sourceId"],
                    "description": item["description"],
                    "reason": "单条预计超过每日上限",
                }
            )
        else:
            usable.append((item, minutes))
    if blocking:
        return [], not_arranged, goal.isoformat(), False, "预计分钟未知或单条超过每日上限"
    start = today + timedelta(days=1)
    if option == "extend":
        start = max(goal + timedelta(days=1), today + timedelta(days=1))
        limit = start + timedelta(days=_SEARCH_DAYS)
    else:
        limit = goal
    arranged: list[dict] = []
    used = dict(loads)
    for item, minutes in usable:
        day = start
        found: date | None = None
        while day <= limit:
            if unknown_days.get(day, 0) == 0 and used.get(day, 0) + minutes <= cap:
                found = day
                break
            day += timedelta(days=1)
        if found is None:
            not_arranged.append(
                {
                    "sourceId": item["sourceId"],
                    "description": item["description"],
                    "reason": "容量不够",
                }
            )
            continue
        used[found] = used.get(found, 0) + minutes
        arranged.append(
            {
                "sourceId": item["sourceId"],
                "taskDate": found.isoformat(),
                "estimatedMinutes": minutes,
                "description": item["description"],
                "phaseId": item["phaseId"],
                "phaseEnd": item.get("phaseEnd"),
                "phaseName": item.get("phaseName") or "",
                "resourceUrl": item.get("resourceUrl"),
                "sourceDate": item["taskDate"],
            }
        )
    failed = [item for item in not_arranged if item["reason"] != "本次不补做"]
    new_goal = goal
    if option == "extend" and arranged:
        last = max(date.fromisoformat(item["taskDate"]) for item in arranged)
        if last <= goal:
            return arranged, not_arranged, goal.isoformat(), False, "延期没有形成更晚的截止"
        new_goal = last
    ok = not failed
    reason = "" if ok else "容量不够"
    if option == "extend" and not arranged and not selected:
        ok = True
        reason = ""
    return arranged, not_arranged, new_goal.isoformat(), ok, reason


def _check_in_rows(session: Session, user_id: uuid.UUID, today: date) -> list[dict]:
    rows = session.scalars(
        select(CheckIn)
        .where(CheckIn.user_id == user_id, CheckIn.check_date == today)
        .order_by(CheckIn.id)
    )
    return [
        {
            "id": str(row.id),
            "checkDate": row.check_date.isoformat(),
            "durationMinutes": row.duration_minutes,
            "difficulty": row.difficulty,
            "energy": row.energy,
            "note": row.note or "",
        }
        for row in rows
    ]


def _same_check_ins(
    session: Session, user_id: uuid.UUID, today: date, stored: list[dict]
) -> bool:
    return _check_in_rows(session, user_id, today) == list(stored)


def _capacity_view(check_ins: list[dict], cap: int) -> dict:
    if not check_ins:
        return {"recordedMinutes": None, "todayAvailable": None, "overLimit": False}
    recorded = sum(int(item["durationMinutes"]) for item in check_ins)
    over = recorded > cap
    return {
        "recordedMinutes": recorded,
        "todayAvailable": 0 if over else cap - recorded,
        "overLimit": over,
    }


def _build(
    session: Session,
    plan: Plan,
    user_id: uuid.UUID,
    today: date,
    candidates: list[dict],
    option: str,
    keep_ids: list[str],
    saved: dict[str, int],
    version: int = 1,
    check_ins: list[dict] | None = None,
) -> dict:
    loads, unknown_counts = _future_load(session, plan, today)
    stored_check_ins = list(check_ins) if check_ins is not None else _check_in_rows(session, user_id, today)
    keep = set(keep_ids)
    views = {}
    for name in _OPTIONS:
        option_keep = set() if name == "reduce" and option != "reduce" else keep
        if name == "reduce" and option != "reduce":
            option_keep = set()
        elif name != option:
            option_keep = {item["sourceId"] for item in candidates}
        else:
            option_keep = keep
        arranged, not_arranged, goal_date, ok, reason = _place(
            candidates,
            option_keep,
            saved,
            name,
            today,
            plan.goal_date,
            plan.daily_minutes,
            loads,
            unknown_counts,
        )
        views[name] = {
            "id": name,
            "label": _OPTION_LABELS[name],
            "ok": ok,
            "goalDate": goal_date,
            "arranged": arranged,
            "notArranged": not_arranged,
            "reason": reason,
        }
    selected = views[option]
    duration_days = _duration_rows(
        loads, unknown_counts, selected["arranged"], plan.daily_minutes
    )
    schedule_clear = all(item["result"] == "pass" for item in duration_days)
    if not schedule_clear:
        if any(item["result"] == "unknown" for item in duration_days):
            schedule_reason = "保留日程有未知分钟"
        else:
            schedule_reason = "保留日程已超过每日上限"
        for name in _OPTIONS:
            views[name]["ok"] = False
            if not views[name]["reason"]:
                views[name]["reason"] = schedule_reason
        selected = views[option]
    capacity = _capacity_view(stored_check_ins, plan.daily_minutes)
    done_count = session.scalar(
        select(func.count())
        .select_from(DailyTask)
        .where(DailyTask.plan_id == plan.id, DailyTask.status == "done")
    ) or 0
    goal_after = selected["goalDate"]
    plan_changes = []
    if goal_after != plan.goal_date.isoformat():
        plan_changes.append(
            {
                "field": "goalDate",
                "before": plan.goal_date.isoformat(),
                "after": goal_after,
            }
        )
    future = list(
        session.scalars(
            select(DailyTask)
            .where(
                DailyTask.plan_id == plan.id,
                DailyTask.status == "pending",
                DailyTask.task_date > today,
            )
            .order_by(DailyTask.task_date, DailyTask.id)
        )
    )
    blocked_unknown = any(item["result"] == "unknown" for item in duration_days) or (
        "预计分钟未知" in selected["reason"]
    )
    if schedule_clear and selected["ok"]:
        check_name = "pass"
    elif blocked_unknown:
        check_name = "unknown"
    else:
        check_name = "fail"
    validation = {
        "ok": bool(selected["ok"]) and schedule_clear,
        "contract": "remedy",
        "checks": {"capacity": check_name, "selection": "pass"},
        "durationDays": duration_days,
    }
    evidence = _evidence(session, plan, candidates, stored_check_ins)
    summary = _summary(selected, capacity, int(done_count))
    proposal = {
        "kind": "remedy",
        "calendarDay": today.isoformat(),
        "checkIns": stored_check_ins,
        "candidates": candidates,
        "selectedOption": option,
        "keepSourceIds": list(keep),
        "savedMinutes": saved,
        "selectionVersion": version,
        "placements": selected["arranged"],
        "goalDate": goal_after,
        "fields": {
            "goalName": plan.goal_name,
            "goalDate": goal_after,
            "currentLevel": plan.current_level,
            "dailyMinutes": plan.daily_minutes,
        },
    }
    diff = {
        "removedOrReplaced": [],
        "proposedPending": [
            {
                "actionId": item["sourceId"],
                "taskDate": item["taskDate"],
                "description": item["description"],
                "status": "pending",
                "estimatedMinutes": item["estimatedMinutes"],
            }
            for item in selected["arranged"]
        ],
        "protectedKept": len(future),
        "planChanges": plan_changes,
        "keptTasks": [
            {
                "id": str(task.id),
                "taskDate": task.task_date.isoformat(),
                "description": task.description,
                "status": task.status,
                "estimatedMinutes": task.estimated_minutes,
            }
            for task in future
        ],
        "remedy": {
            "selectedOption": option,
            "options": [
                {
                    "id": views[name]["id"],
                    "label": views[name]["label"],
                    "ok": views[name]["ok"],
                    "goalDate": views[name]["goalDate"],
                    "reason": views[name]["reason"],
                }
                for name in _OPTIONS
            ],
            "arranged": selected["arranged"],
            "notArranged": selected["notArranged"],
            "candidates": _display_candidates(candidates, saved),
            "doneCount": int(done_count),
            "dailyMinutes": plan.daily_minutes,
            "phaseHistoryUnchanged": True,
            **capacity,
        },
    }
    steps = [
        {"step": "collect_feedback", "result": "ok"},
        {
            "step": "generate_proposal",
            "result": "ok",
            "method": "code",
            "model": "not_called",
            "mock": False,
        },
        {"step": "rule_check", "result": "ok" if selected["ok"] else "fail", "checks": validation["checks"]},
        {"step": "await_confirm", "result": "pending"},
    ]
    return {
        "proposal": proposal,
        "diff": diff,
        "validation": validation,
        "steps": steps,
        "summary": summary,
        "evidence": evidence,
    }


def _summary(selected: dict, capacity: dict, done_count: int) -> str:
    recorded = capacity["recordedMinutes"]
    recorded_text = "未记录" if recorded is None else f"{recorded} 分钟"
    arranged = "、".join(item["sourceId"][:8] for item in selected["arranged"]) or "无"
    skipped = "、".join(
        item["sourceId"][:8]
        for item in selected["notArranged"]
        if item["reason"] == "本次不补做"
    ) or "无"
    return (
        f"补救方案「{selected['label']}」，未调用模型。"
        f"已完成任务 {done_count} 条，今日已记录投入 {recorded_text}。"
        f"本次安排 {arranged}。本次不补做 {skipped}。"
        "阶段历史结束日不改。尚未写入规划。"
    )


def _evidence(
    session: Session, plan: Plan, candidates: list[dict], check_ins: list[dict]
) -> list[dict]:
    refs: list[dict] = []
    for item in candidates:
        refs.append(
            {
                "kind": "task",
                "actionId": item["sourceId"],
                "taskId": item["sourceId"],
                "taskDate": item["taskDate"],
                "description": item["description"],
                "status": "pending",
                "estimatedMinutes": item.get("estimatedMinutes"),
                "text": "过期且未标记完成的待补候选",
            }
        )
    for item in check_ins:
        refs.append(
            {
                "kind": "checkin",
                "checkInId": item["id"],
                "checkDate": item["checkDate"],
                "durationMinutes": item["durationMinutes"],
                "difficulty": item["difficulty"],
                "energy": item["energy"],
                "note": item["note"],
                "text": item["note"],
                "source": "daily_check_in",
            }
        )
    wrong = session.scalars(
        select(PracticeQuestion)
        .join(DailyTask, DailyTask.id == PracticeQuestion.source_task_id)
        .where(
            DailyTask.plan_id == plan.id,
            PracticeQuestion.status == "wrong",
        )
    )
    for row in wrong:
        refs.append(
            {
                "kind": "practice",
                "questionId": str(row.id),
                "taskId": str(row.source_task_id) if row.source_task_id else None,
                "status": "wrong",
                "text": "补充，不参与容量",
            }
        )
    return refs


def _confirm_still_matches(
    session: Session,
    user_id: uuid.UUID,
    plan: Plan,
    row: PlanAdjustment,
    today: date,
) -> bool:
    proposal = dict(row.proposal or {})
    if proposal.get("calendarDay") != today.isoformat():
        return False
    if not _same_check_ins(session, user_id, today, list(proposal.get("checkIns") or [])):
        return False
    candidates = list(proposal.get("candidates") or [])
    if _candidates(session, plan, today) != _strip_live(candidates):
        return False
    stored_cap = (proposal.get("fields") or {}).get("dailyMinutes")
    if stored_cap != plan.daily_minutes:
        return False
    loads, unknown_counts = _future_load(session, plan, today)
    arranged, _skipped, goal_date, ok, _reason = _place(
        candidates,
        set(proposal.get("keepSourceIds") or []),
        dict(proposal.get("savedMinutes") or {}),
        str(proposal.get("selectedOption") or "spread"),
        today,
        plan.goal_date,
        plan.daily_minutes,
        loads,
        unknown_counts,
    )
    duration_days = _duration_rows(loads, unknown_counts, arranged, plan.daily_minutes)
    if any(item["result"] != "pass" for item in duration_days):
        return False
    if not ok or not (row.validation or {}).get("ok", False):
        return False
    if arranged != list(proposal.get("placements") or []):
        return False
    return goal_date == proposal.get("goalDate")


def _strip_live(candidates: list[dict]) -> list[dict]:
    keys = (
        "sourceId",
        "taskDate",
        "description",
        "estimatedMinutes",
        "phaseId",
        "phaseEnd",
        "phaseName",
        "resourceUrl",
    )
    return [{key: item.get(key) for key in keys} for item in candidates]


def _apply_remedy(session: Session, plan: Plan, row: PlanAdjustment) -> None:
    proposal = dict(row.proposal or {})
    placements = list(proposal.get("placements") or [])
    phases = list(session.scalars(select(Phase).where(Phase.plan_id == plan.id)))
    phases_before = {str(phase.id): _phase_record(phase) for phase in phases}
    goal_before = plan.goal_date.isoformat()
    created_ids: list[str] = []
    created_copies: list[dict] = []
    sources: dict[str, dict] = {}
    for item in placements:
        source = session.get(DailyTask, uuid.UUID(item["sourceId"]))
        if source is None or source.status != "pending" or source.plan_id != plan.id:
            raise AdjustmentConflictError("待补任务已变化，请重新生成预览")
        child = session.scalar(
            select(DailyTask).where(
                DailyTask.carried_from_id == source.id,
                DailyTask.status == "pending",
            )
        )
        if child is not None:
            raise AdjustmentConflictError("该任务已有活动副本，请重新生成预览")
        if source.id in task_service.answered_practice_task_ids(session, plan.id):
            raise AdjustmentConflictError("任务已有作答，不能安排")
        original_minutes = source.estimated_minutes
        source.status = "carried"
        placed_day = date.fromisoformat(item["taskDate"])
        copy = DailyTask(
            plan_id=plan.id,
            phase_id=source.phase_id,
            task_date=placed_day,
            week_label=f"W{placed_day.isocalendar().week:02d}",
            description=source.description,
            status="pending",
            carried_from_id=source.id,
            resource_url=source.resource_url,
            chapter_title=source.chapter_title,
            section_title=source.section_title,
            estimated_minutes=item["estimatedMinutes"],
        )
        session.add(copy)
        session.flush()
        created_ids.append(str(copy.id))
        created_copies.append(_task_snapshot(copy))
        sources[str(source.id)] = {
            "statusBefore": "pending",
            "statusAfter": "carried",
            "taskDate": source.task_date.isoformat(),
            "description": source.description,
            "estimatedMinutes": original_minutes,
            "phaseId": str(source.phase_id),
            "after": _task_snapshot(source),
        }
        if source.estimated_minutes != original_minutes:
            raise AdjustmentConflictError("源任务预计分钟被改动，已拒绝")
    goal_after = str(proposal.get("goalDate") or goal_before)
    if goal_after != goal_before:
        parsed = date.fromisoformat(goal_after)
        if parsed <= plan.goal_date:
            raise PlanGenerationError("目标日期必须是有效的 YYYY-MM-DD，请重新生成预览")
        plan.goal_date = parsed
    session.flush()
    affected = {uuid.UUID(item["phaseId"]) for item in sources.values()}
    for phase_id in affected:
        phase = session.get(Phase, phase_id)
        if phase is not None:
            task_service.recompute_phase_progress(session, phase)
    phases_after = {
        str(phase.id): _phase_record(phase)
        for phase in session.scalars(select(Phase).where(Phase.plan_id == plan.id))
    }
    for phase_id, before in phases_before.items():
        after = phases_after.get(phase_id)
        if after is None:
            continue
        if before["startDate"] != after["startDate"] or before["endDate"] != after["endDate"]:
            raise AdjustmentConflictError("阶段历史日期被改动，已拒绝")
    row.applied_record = {
        "kind": "remedy",
        "remedySources": sources,
        "createdTaskIds": created_ids,
        "createdCopies": created_copies,
        "phasesBefore": phases_before,
        "phasesAfter": phases_after,
        "goalBefore": goal_before,
        "goalAfter": plan.goal_date.isoformat(),
    }
    row.steps = list(row.steps or []) + [{"step": "confirm", "result": "applied"}]
    row.decision_summary = (
        f"已确认补救：{len(created_ids)} 条新副本，"
        f"{len(sources)} 条源任务改为已顺延。其他任务未替换。完成数不因换日期增加。"
    )


def _phase_record(phase: Phase) -> dict:
    return {
        "isCurrent": bool(phase.is_current),
        "startDate": phase.start_date.isoformat(),
        "endDate": phase.end_date.isoformat(),
        "name": phase.name,
    }


def _task_snapshot(task: DailyTask) -> dict:
    return {
        "id": str(task.id),
        "status": task.status,
        "taskDate": task.task_date.isoformat(),
        "description": task.description,
        "estimatedMinutes": task.estimated_minutes,
        "phaseId": str(task.phase_id),
        "resourceUrl": task.resource_url,
        "carriedFromId": str(task.carried_from_id) if task.carried_from_id else None,
        "weekLabel": task.week_label,
    }


def _display_candidates(candidates: list[dict], saved: dict[str, int]) -> list[dict]:
    shown: list[dict] = []
    for item in candidates:
        row = dict(item)
        value = saved.get(item["sourceId"])
        if isinstance(value, int) and not isinstance(value, bool):
            row["estimatedMinutes"] = value
        shown.append(row)
    return shown


def _duration_rows(
    loads: dict[date, int],
    unknown_counts: dict[date, int],
    arranged: list[dict],
    cap: int,
) -> list[dict]:
    extra: dict[date, int] = {}
    days = set(loads) | set(unknown_counts)
    for item in arranged:
        day = date.fromisoformat(item["taskDate"])
        days.add(day)
        extra[day] = extra.get(day, 0) + int(item["estimatedMinutes"])
    rows: list[dict] = []
    for day in sorted(days):
        known = loads.get(day, 0) + extra.get(day, 0)
        unknown = unknown_counts.get(day, 0)
        if unknown:
            result = "unknown"
        elif known > cap:
            result = "fail"
        else:
            result = "pass"
        rows.append(
            {
                "date": day.isoformat(),
                "knownMinutes": known,
                "unknownCount": unknown,
                "cap": cap,
                "result": result,
            }
        )
    return rows


def _replay_changed_fields(session: Session, plan: Plan, record: dict) -> None:
    before_map = record.get("phasesBefore") or {}
    after_map = record.get("phasesAfter") or {}
    if set(before_map) != set(after_map):
        raise AdjustmentConflictError("阶段记录不完整，不能撤销")
    for phase_id, before in before_map.items():
        after = after_map[phase_id]
        phase = session.get(Phase, uuid.UUID(phase_id))
        if phase is None:
            raise AdjustmentConflictError("阶段已不存在，不能撤销")
        live = _phase_record(phase)
        for key in (
            "isCurrent",
            "startDate",
            "endDate",
            "name",
        ):
            if before.get(key) != after.get(key) and live.get(key) != after.get(key):
                raise AdjustmentConflictError("阶段在确认后已变化，不能撤销")
        if before.get("isCurrent") != after.get("isCurrent"):
            phase.is_current = bool(before["isCurrent"])
        if before.get("startDate") != after.get("startDate"):
            phase.start_date = date.fromisoformat(before["startDate"])
        if before.get("endDate") != after.get("endDate"):
            phase.end_date = date.fromisoformat(before["endDate"])
        if before.get("name") != after.get("name"):
            phase.name = before["name"]
    goal_before = record.get("goalBefore")
    goal_after = record.get("goalAfter")
    if goal_before != goal_after:
        if plan.goal_date.isoformat() != goal_after:
            raise AdjustmentConflictError("截止在确认后已变化，不能撤销")
        plan.goal_date = date.fromisoformat(str(goal_before))


def _assert_remedy_undo_safe(session: Session, record: dict) -> None:
    copies = list(record.get("createdCopies") or [])
    ids = list(record.get("createdTaskIds") or [])
    if [item.get("id") for item in copies] != ids:
        raise AdjustmentConflictError("补救副本快照不完整，不能撤销")
    today = local_today()
    for snap in copies:
        task = session.get(DailyTask, uuid.UUID(snap["id"]))
        if task is None:
            raise AdjustmentConflictError("补救副本已不存在，不能撤销")
        if task.task_date < today:
            raise AdjustmentConflictError("补救副本已早于今天，不能撤销")
        if _task_snapshot(task) != snap:
            raise AdjustmentConflictError("补救副本已变化，不能撤销")
        if _answered(session, task.id):
            raise AdjustmentConflictError("任务已有作答反馈，不能撤销")
    for source_id, expected in (record.get("remedySources") or {}).items():
        source = session.get(DailyTask, uuid.UUID(source_id))
        after = expected.get("after") if isinstance(expected, dict) else None
        if source is None or not isinstance(after, dict) or _task_snapshot(source) != after:
            raise AdjustmentConflictError("原任务已变化，不能撤销")
        if _answered(session, source.id):
            raise AdjustmentConflictError("任务已有作答反馈，不能撤销")


def _answered(session: Session, task_id: uuid.UUID) -> bool:
    row = session.scalar(
        select(PracticeQuestion.id).where(
            PracticeQuestion.source_task_id == task_id,
            PracticeQuestion.status.in_(("correct", "wrong")),
        )
    )
    return row is not None
