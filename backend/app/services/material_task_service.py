"""Preview tasks from the current material selection. Does not confirm or persist."""

from datetime import date, timedelta
import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import local_today
from app.models.entities import Plan
from app.services import adjustment_service, planner_service
from app.services.api_config_service import has_verified_api_config
from app.services.evidence_time import check_schedule_order, duration_report, load_owned_chunks
from app.services.material_comparison_service import COMPARISON_TTL, MaterialComparisonError, _now
from app.services.material_comparison_store import material_comparison_store
from app.services.material_task_preview_store import MaterialTaskPreview, material_task_preview_store
from app.services.planner_service import PlanGenerationError

_SYSTEM_PROMPT = """你是 StudyPilot 的资料任务预览助手。只输出一个 JSON 对象，不要 Markdown。
JSON 形状必须为：
{"phases":[{"name":"阶段名","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","daily_tasks":[{"task_date":"YYYY-MM-DD","description":"动作和预期产出","estimated_minutes":30}]}]}
阶段数是 2 到 12 的整数。description 要写明具体动作和预期产出。
estimated_minutes 是正整数预计分钟。不知道就省略这个字段，不要填 0。
没有依据的日期不要写出任务。不要编造先修关系。不要使用本次用户消息之外的资料。不要输出 citations。"""


def _goal_changed(left: dict, right: dict) -> bool:
    keys = ("goalName", "goalDate", "currentLevel", "dailyMinutes", "completionCriterion")
    return any(left.get(key) != right.get(key) for key in keys)


def _owned_plan(session: Session, user_id: uuid.UUID, plan_id: str) -> Plan:
    try:
        parsed = uuid.UUID(plan_id)
    except (ValueError, TypeError, AttributeError) as error:
        raise MaterialComparisonError(404, "PLAN_NOT_FOUND", "没有这份规划") from error
    plan = session.scalar(select(Plan).where(Plan.id == parsed, Plan.user_id == user_id))
    if plan is None:
        raise MaterialComparisonError(404, "PLAN_NOT_FOUND", "没有这份规划")
    return plan


def _snapshot(plan: Plan) -> dict:
    return {
        "goalName": plan.goal_name,
        "goalDate": plan.goal_date.isoformat(),
        "currentLevel": plan.current_level,
        "dailyMinutes": plan.daily_minutes,
        "completionCriterion": plan.completion_criterion,
    }


def _selected(item):
    if not item.selected_id:
        raise MaterialComparisonError(409, "NO_SELECTION", "请选择一份资料后再生成预览")
    candidate = next((row for row in item.candidates if row["candidateId"] == item.selected_id), None)
    if candidate is None:
        raise MaterialComparisonError(404, "CANDIDATE_NOT_FOUND", "这次比较里没有这份资料")
    if candidate.get("usableSource") is not True or candidate.get("readStatus") != "read":
        raise MaterialComparisonError(409, "SOURCE_UNAVAILABLE", "这份资料没有可用正文，不能生成任务")
    return candidate


def _hashes_match(session: Session, user_id: uuid.UUID, candidate: dict) -> bool:
    if candidate["kind"] != "document":
        return True
    doc_id = str(candidate["source"]["docId"])
    current = load_owned_chunks(session, user_id, [doc_id])
    live = [(int(chunk["chunkIndex"]), str(chunk["contentHash"])) for chunk in current]
    stored = [tuple(pair) for pair in candidate.get("chunkHashes") or []]
    return live == stored and bool(stored)


def _freeze(item, candidate: dict) -> dict:
    facts = candidate["facts"]
    if candidate["kind"] == "document":
        basis = {
            "kind": "document",
            "docId": candidate["source"]["docId"],
            "chunks": [
                {
                    "chunkIndex": excerpt["chunkIndex"],
                    "contentHash": excerpt["contentHash"],
                    "pageStart": excerpt.get("pageStart"),
                    "included": True,
                    "content": excerpt["content"],
                }
                for excerpt in facts.get("excerpts") or []
            ],
        }
    else:
        basis = {
            "kind": "link",
            "url": candidate["source"]["url"],
            "coverage": facts.get("coverage") or "",
            "playSeconds": facts["duration"]["playSeconds"],
            "playNote": facts["duration"]["note"],
        }
    return {
        "comparisonId": item.comparison_id,
        "selectedCandidateId": item.selected_id,
        "planId": item.plan_id,
        "goal": dict(item.goal),
        "basis": basis,
        "displayName": candidate.get("displayName") or "",
    }


def _user_prompt(frozen: dict) -> str:
    goal = frozen["goal"]
    criterion = goal.get("completionCriterion") or "未知"
    lines = [
        "只根据下面这次目标和选定资料安排任务。",
        (
            f"目标 {goal.get('goalName')} 期限 {goal.get('goalDate')} "
            f"基础 {goal.get('currentLevel')} 每日 {goal.get('dailyMinutes')} 分钟 "
            f"完成标准 {criterion}"
        ),
        "播放时长不是预计分钟，也不是完整学习耗时。",
    ]
    basis = frozen["basis"]
    if basis["kind"] == "document":
        lines.append(f"选定文档 {basis['docId']}。文件名只用于显示：{frozen['displayName']}。")
        for chunk in basis["chunks"]:
            page = chunk["pageStart"] if chunk.get("pageStart") is not None else "未知"
            lines.append(
                f"纳入片段 {chunk['chunkIndex']} 哈希 {chunk['contentHash']} 页码 {page}\n{chunk['content']}"
            )
    else:
        lines.append(
            f"选定链接 {basis['url']}。这是一份链接资料，读到的内容如下：\n{basis['coverage']}"
        )
        lines.append(
            f"已读播放秒 {basis['playSeconds'] if basis['playSeconds'] is not None else '未知'}。"
            f"{basis['playNote']}"
        )
    return "\n".join(lines)


def _live_goal(session: Session, user_id: uuid.UUID, plan_id: str) -> dict:
    plan = _owned_plan(session, user_id, plan_id)
    session.expire(plan)
    session.refresh(plan)
    return _snapshot(plan)


def _recheck_current(session: Session, user_id: uuid.UUID, generation_id: str, frozen: dict) -> None:
    if material_task_preview_store.generation(user_id) != generation_id:
        raise MaterialComparisonError(409, "GENERATION_STALE", "这次生成已经过期，请重新生成预览")
    item = material_comparison_store.get(frozen["comparisonId"], user_id)
    if item is None:
        raise MaterialComparisonError(409, "GENERATION_STALE", "这次生成已经过期，请重新生成预览")
    if _now() - item.created_at > COMPARISON_TTL:
        raise MaterialComparisonError(409, "COMPARISON_EXPIRED", "这次比较已过期，请重新比较")
    if item.selected_id != frozen["selectedCandidateId"]:
        raise MaterialComparisonError(409, "GENERATION_STALE", "这次生成已经过期，请重新生成预览")
    if (item.plan_id or None) != (frozen["planId"] or None):
        raise MaterialComparisonError(409, "PLAN_CHANGED", "规划已变化，请重新比较")
    if item.plan_id:
        if _goal_changed(_live_goal(session, user_id, item.plan_id), frozen["goal"]):
            raise MaterialComparisonError(409, "GOAL_CHANGED", "规划目标已变化，请重新比较")
    elif _goal_changed(item.goal, frozen["goal"]):
        raise MaterialComparisonError(409, "GOAL_CHANGED", "目标已变化，请重新比较")
    candidate = next(row for row in item.candidates if row["candidateId"] == item.selected_id)
    if not _hashes_match(session, user_id, candidate):
        raise MaterialComparisonError(409, "SOURCE_CHANGED", "资料已变化或已删除，请重新比较")


_EMPTY_DATE_LIMIT = 3660


def _empty_dates(phases: list[dict], today: date, goal: date) -> list[str]:
    if goal < today:
        return []
    try:
        if (goal - today).days > _EMPTY_DATE_LIMIT:
            return []
    except OverflowError:
        return []
    found: list[str] = []
    for phase in phases:
        try:
            start = date.fromisoformat(str(phase.get("start_date")))
            end = date.fromisoformat(str(phase.get("end_date")))
        except ValueError:
            continue
        if start > end:
            continue
        first = max(start, today)
        last = min(end, goal)
        if first > last or (last - first).days > _EMPTY_DATE_LIMIT:
            continue
        covered: set[date] = set()
        for task in phase.get("daily_tasks") or []:
            try:
                task_date = date.fromisoformat(str(task.get("task_date")))
            except ValueError:
                continue
            if first <= task_date <= last:
                covered.add(task_date)
        day = first
        while day <= last:
            if day not in covered:
                found.append(day.isoformat())
            if day >= date.max:
                break
            try:
                day += timedelta(days=1)
            except OverflowError:
                break
    return found


def _public(item: MaterialTaskPreview) -> dict:
    basis = dict(item.basis)
    if basis.get("kind") == "document":
        basis = {
            "kind": "document",
            "docId": basis["docId"],
            "chunks": [
                {
                    "chunkIndex": chunk["chunkIndex"],
                    "contentHash": chunk["contentHash"],
                    "pageStart": chunk.get("pageStart"),
                    "included": True,
                }
                for chunk in basis.get("chunks") or []
            ],
        }
    return {
        "previewId": item.preview_id,
        "previewVersion": item.preview_version,
        "confirmOpen": False,
        "comparisonId": item.comparison_id,
        "selectedCandidateId": item.selected_candidate_id,
        "planId": item.plan_id,
        "displayName": item.display_name,
        "basis": basis,
        "emptyDates": list(item.empty_dates),
        "validation": item.validation,
        "phases": [
            {
                "name": phase.get("name"),
                "startDate": phase.get("start_date"),
                "endDate": phase.get("end_date"),
                "tasks": [
                    {
                        "actionId": task.get("action_id"),
                        "taskDate": task.get("task_date"),
                        "description": task.get("description"),
                        "estimatedMinutes": task.get("estimated_minutes"),
                    }
                    for task in phase.get("daily_tasks") or []
                ],
            }
            for phase in item.phases
        ],
    }


async def default_material_task_model(session: Session, user_id: uuid.UUID, system: str, user: str) -> str:
    """Send the isolated preview prompt through the existing chat transport."""
    from app.services.ai_proxy import resolve_credential
    from app.services.assistant_service import openai_compatible_chat_stream

    credential = resolve_credential(session, user_id)
    payload = {
        "model": credential.model_type,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    parts: list[str] = []
    async with openai_compatible_chat_stream(credential, payload) as stream:
        async for delta in stream:
            parts.append(delta)
    text = "".join(parts).strip()
    if not text or text == "（模型未返回内容）":
        raise RuntimeError("模型没有返回任务预览")
    return text


async def preview_material_tasks(
    session: Session,
    user_id: uuid.UUID,
    comparison_id: str,
    submitted_goal: dict,
    submitted_plan_id: str | None,
    model,
) -> dict:
    item = material_comparison_store.get(comparison_id, user_id)
    if item is None:
        raise MaterialComparisonError(404, "COMPARISON_NOT_FOUND", "这次比较不存在，请重新比较")
    generation_id = secrets.token_urlsafe(9)
    material_task_preview_store.claim(user_id, generation_id)
    if _now() - item.created_at > COMPARISON_TTL:
        raise MaterialComparisonError(409, "COMPARISON_EXPIRED", "这次比较已过期，请重新比较")
    if (submitted_plan_id or None) != (item.plan_id or None):
        raise MaterialComparisonError(409, "PLAN_CHANGED", "规划已变化，请重新比较")
    if item.plan_id:
        if _goal_changed(item.goal, _live_goal(session, user_id, item.plan_id)):
            raise MaterialComparisonError(409, "GOAL_CHANGED", "规划目标已变化，请重新比较")
    elif _goal_changed(item.goal, submitted_goal):
        raise MaterialComparisonError(409, "GOAL_CHANGED", "目标已变化，请重新比较")
    candidate = _selected(item)
    if not _hashes_match(session, user_id, candidate):
        raise MaterialComparisonError(409, "SOURCE_CHANGED", "资料已变化或已删除，请重新比较")
    frozen = _freeze(item, candidate)
    system = _SYSTEM_PROMPT
    user_prompt = _user_prompt(frozen)
    if model is None and not has_verified_api_config(session, user_id):
        raise MaterialComparisonError(409, "NO_API_KEY", "没有已验证的模型配置，没有生成预览")
    try:
        if model is None:
            text = await default_material_task_model(session, user_id, system, user_prompt)
        else:
            text = await model(system, user_prompt)
    except MaterialComparisonError:
        raise
    except Exception as error:
        raise MaterialComparisonError(502, "MODEL_FAILED", "模型没有返回可用的任务预览") from error
    _recheck_current(session, user_id, generation_id, frozen)
    try:
        structure = planner_service._parse_plan_structure_from_text(text)
        phases = planner_service._validate_structure(structure)
        today = local_today()
        goal_date = date.fromisoformat(str(frozen["goal"]["goalDate"]))
        try:
            apply_phases, date_note = adjustment_service._exact_apply_phases(phases, today, goal_date)
            date_overflow = False
        except OverflowError:
            apply_phases = phases
            date_note = None
            date_overflow = True
        if item.plan_id:
            plan = _owned_plan(session, user_id, item.plan_id)
            session.expire(plan)
            session.refresh(plan)
            dated, protected = adjustment_service._kept_future_and_minutes(
                session, plan, today, goal_date, apply_phases
            )
            cap = int(plan.daily_minutes)
        else:
            dated = []
            protected = []
            cap = int(frozen["goal"]["dailyMinutes"])
            for phase in apply_phases:
                for task in phase.get("daily_tasks") or []:
                    try:
                        dated.append((date.fromisoformat(str(task.get("task_date"))), task.get("estimated_minutes")))
                    except ValueError:
                        continue
        duration = duration_report(dated, cap, today, goal_date)
        schedule = "fail" if date_overflow else check_schedule_order(apply_phases, goal_date, protected, today=today)
        validation = adjustment_service._run_code_checks(
            apply_phases,
            [],
            evidence_status="pass",
            duration_status=str(duration["result"]),
            schedule_status=schedule,
            duration_days=list(duration["days"]),
            date_note=date_note,
        )
    except (PlanGenerationError, ValueError) as error:
        raise MaterialComparisonError(422, "MODEL_OUTPUT_INVALID", "模型结果不能变成任务预览") from error
    _recheck_current(session, user_id, generation_id, frozen)
    preview = MaterialTaskPreview(
        user_id=user_id,
        preview_id=secrets.token_urlsafe(9),
        generation_id=generation_id,
        comparison_id=item.comparison_id,
        selected_candidate_id=str(item.selected_id),
        plan_id=item.plan_id,
        goal=dict(frozen["goal"]),
        basis=frozen["basis"],
        phases=apply_phases,
        validation=validation,
        empty_dates=[] if date_overflow else _empty_dates(apply_phases, today, goal_date),
        display_name=frozen["displayName"],
    )
    if not material_task_preview_store.publish(preview):
        raise MaterialComparisonError(409, "GENERATION_STALE", "这次生成已经过期，请重新生成预览")
    return _public(preview)
