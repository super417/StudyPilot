"""Compare documents and links the user handed over. Selection stays in memory."""

from datetime import datetime, timedelta, timezone
import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Plan
from app.services import planner_service
from app.services.evidence_time import content_hash, load_owned_chunks
from app.services.material_comparison_store import MaterialComparison, material_comparison_store
from app.services.plan_draft_store import plan_draft_store

INCLUDED_CHARS = 1000
COMPARISON_TTL = timedelta(minutes=30)


class MaterialComparisonError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(message)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _goal_label(criterion: str | None) -> str:
    return "未知" if not criterion else criterion


def _public_goal(goal: dict) -> dict:
    criterion = goal.get("completionCriterion")
    return {
        **goal,
        "completionCriterion": criterion,
        "completionCriterionLabel": _goal_label(criterion if isinstance(criterion, str) else None),
    }


def _public(item: MaterialComparison) -> dict:
    return {
        "comparisonId": item.comparison_id,
        "planId": item.plan_id,
        "createdAt": item.created_at.isoformat(),
        "expiresAt": (item.created_at + COMPARISON_TTL).isoformat(),
        "goal": _public_goal(item.goal),
        "selectedCandidateId": item.selected_id,
        "suggestion": item.suggestion,
        "candidates": [
            {key: value for key, value in candidate.items() if key != "chunkHashes"}
            for candidate in item.candidates
        ],
    }


def _owned_plan(session: Session, user_id: uuid.UUID, plan_id: str) -> Plan:
    try:
        parsed = uuid.UUID(plan_id)
    except (ValueError, TypeError, AttributeError) as error:
        raise MaterialComparisonError(404, "PLAN_NOT_FOUND", "没有这份规划") from error
    plan = session.scalar(
        select(Plan).where(Plan.id == parsed, Plan.user_id == user_id)
    )
    if plan is None:
        raise MaterialComparisonError(404, "PLAN_NOT_FOUND", "没有这份规划")
    return plan


def _snapshot_from_plan(plan: Plan) -> dict:
    return {
        "goalName": plan.goal_name,
        "goalDate": plan.goal_date.isoformat(),
        "currentLevel": plan.current_level,
        "dailyMinutes": plan.daily_minutes,
        "completionCriterion": plan.completion_criterion,
    }


def _require_new_goal(goal: dict) -> None:
    missing = planner_service.missing_fields(goal)
    if missing:
        raise MaterialComparisonError(400, "GOAL_INCOMPLETE", "目标还不完整，不能比较资料")


def _document_candidate(session: Session, user_id: uuid.UUID, doc_id: str) -> dict:
    chunks = load_owned_chunks(session, user_id, [doc_id])
    hashes = [(int(chunk["chunkIndex"]), str(chunk["contentHash"])) for chunk in chunks]
    if not chunks:
        return {
            "candidateId": f"doc:{doc_id}",
            "kind": "document",
            "readStatus": "failed",
            "displayName": doc_id,
            "source": {"docId": doc_id},
            "chunkHashes": hashes,
            "usableSource": False,
            "facts": {
                "excerpts": [],
                "unreadChunkCount": 0,
                "unreadNote": "",
                "basisNote": "没有读到这份资料，不能作为学习依据。",
                "prerequisite": "未知",
                "coverage": "未知",
                "duration": {"status": "未知", "playSeconds": None, "note": "文档没有播放时长。"},
            },
        }
    included: list[dict] = []
    used = 0
    for chunk in chunks:
        if used >= INCLUDED_CHARS:
            break
        included.append(chunk)
        used += len(str(chunk["content"]))
    unread = len(chunks) - len(included)
    excerpts = [
        {
            "chunkIndex": int(chunk["chunkIndex"]),
            "content": chunk["content"],
            "contentHash": chunk["contentHash"],
            "pageStart": chunk.get("pageStart"),
        }
        for chunk in included
    ]
    coverage = "\n".join(str(chunk["content"]) for chunk in included)
    note = ""
    if unread:
        note = f"还有 {unread} 个片段这次没有读入。没读到不等于文档没讲。"
    return {
        "candidateId": f"doc:{doc_id}",
        "kind": "document",
        "readStatus": "read",
        "displayName": str(chunks[0]["filename"]),
        "source": {"docId": doc_id},
        "chunkHashes": hashes,
        "usableSource": True,
        "facts": {
            "excerpts": excerpts,
            "unreadChunkCount": unread,
            "unreadNote": note,
            "basisNote": "",
            "prerequisite": "未知",
            "coverage": coverage,
            "duration": {"status": "未知", "playSeconds": None, "note": "文档没有播放时长。"},
        },
    }


def _link_candidate(url: str, material: dict | None, index: int) -> dict:
    candidate_id = f"link:{index}"
    source = {"url": url}
    empty_duration = {"status": "未知", "playSeconds": None, "note": "时长未知。"}
    if not material:
        return {
            "candidateId": candidate_id,
            "kind": "link",
            "readStatus": "failed",
            "displayName": url,
            "source": source,
            "chunkHashes": [],
            "usableSource": False,
            "facts": {
                "excerpts": [],
                "unreadChunkCount": 0,
                "unreadNote": "",
                "basisNote": "没有读到这份资料，不能作为学习依据。",
                "prerequisite": "未知",
                "coverage": "未知",
                "duration": empty_duration,
            },
        }
    title = str(material.get("title") or url)
    summary = str(material.get("summary") or "").strip()
    body = str(material.get("body") or "").strip()
    sections = list(material.get("sections") or [])
    labels = [str(section.get("label") or "").strip() for section in sections if section.get("label")]
    has_outline = bool(material.get("has_outline")) and bool(labels)
    play_seconds = 0
    missing_duration = False
    for section in sections:
        raw = section.get("duration")
        if not raw:
            missing_duration = True
            continue
        play_seconds += int(raw)
    if play_seconds and missing_duration:
        duration = {
            "status": "未知",
            "playSeconds": play_seconds,
            "note": "已读播放时长不是完整学习耗时。",
        }
    elif play_seconds and not missing_duration:
        duration = {
            "status": "已知",
            "playSeconds": play_seconds,
            "note": "已读播放时长不是完整学习耗时。",
        }
    else:
        duration = empty_duration
    if not has_outline and not summary and not body:
        return {
            "candidateId": candidate_id,
            "kind": "link",
            "readStatus": "title_only",
            "displayName": title,
            "source": source,
            "chunkHashes": [],
            "usableSource": False,
            "facts": {
                "excerpts": [],
                "unreadChunkCount": 0,
                "unreadNote": "",
                "basisNote": "只有标题，没有正文或章节，不能作为学习依据。",
                "prerequisite": "未知",
                "coverage": "未知",
                "duration": duration,
            },
        }
    coverage_parts = []
    if summary:
        coverage_parts.append(summary)
    if body:
        coverage_parts.append(body)
    if has_outline:
        coverage_parts.append("目录：" + "、".join(labels))
    return {
        "candidateId": candidate_id,
        "kind": "link",
        "readStatus": "read",
        "displayName": title,
        "source": source,
        "chunkHashes": [],
        "usableSource": True,
        "facts": {
            "excerpts": [],
            "unreadChunkCount": 0,
            "unreadNote": "目录没列出不等于没讲。" if has_outline else "",
            "basisNote": "",
            "prerequisite": "未知",
            "coverage": "\n".join(coverage_parts) if coverage_parts else "未知",
            "duration": duration,
        },
    }


def _model_input(candidates: list[dict], goal: dict) -> str:
    criterion = goal.get("completionCriterion") or "未知"
    lines = [
        "只根据这次固定快照比较，不要引用下面没有出现的文档。",
        (
            f"目标 {goal.get('goalName')} 期限 {goal.get('goalDate')} "
            f"基础 {goal.get('currentLevel')} 每日 {goal.get('dailyMinutes')} 分钟 "
            f"完成标准 {criterion}"
        ),
        "请分项说明先修、覆盖、来源、时间和是否适合该目标。缺证据就写未知。",
    ]
    for item in candidates:
        facts = item["facts"]
        source = item["source"]
        identity = source.get("url") or source.get("docId") or ""
        if facts["excerpts"]:
            positions = "、".join(
                f"片段{excerpt['chunkIndex']}"
                + (
                    f"页{excerpt['pageStart']}"
                    if excerpt.get("pageStart") is not None
                    else "页码未知"
                )
                for excerpt in facts["excerpts"]
            )
        else:
            positions = "没有纳入片段"
        play = facts["duration"]["playSeconds"]
        lines.append(
            f"候选 {item['candidateId']} 名称 {item['displayName']} 来源 {identity} "
            f"读取状态 {item['readStatus']} 读取范围 {positions} "
            f"未读片段 {facts['unreadChunkCount']} 覆盖 {facts['coverage']} "
            f"先修 {facts['prerequisite']} 时长状态 {facts['duration']['status']} "
            f"播放秒 {play if play is not None else '未知'} "
            f"依据 {facts.get('basisNote') or '有读到的内容'}"
        )
    return "\n".join(lines)


async def default_material_advisor(session: Session, user_id: uuid.UUID, facts: str, goal: dict) -> str:
    """Call the user's verified model with this comparison snapshot only."""
    from app.services.ai_proxy import resolve_credential
    from app.services.assistant_service import openai_compatible_chat_stream

    credential = resolve_credential(session, user_id)
    payload = {
        "model": credential.model_type,
        "messages": [
            {
                "role": "system",
                "content": "只根据用户给出的这次资料快照回答。缺证据写未知。不要把标题或播放时长说成质量，也不要补充快照之外的文档。",
            },
            {"role": "user", "content": facts if facts else _model_input([], goal)},
        ],
    }
    parts: list[str] = []
    async with openai_compatible_chat_stream(credential, payload) as stream:
        async for delta in stream:
            parts.append(delta)
    text = "".join(parts).strip()
    if not text or text == "（模型未返回内容）":
        raise RuntimeError("模型没有返回建议")
    return text


def _hashes_still_match(session: Session, user_id: uuid.UUID, candidate: dict) -> bool:
    if candidate["kind"] != "document":
        return True
    doc_id = str(candidate["source"]["docId"])
    current = load_owned_chunks(session, user_id, [doc_id])
    live = [(int(chunk["chunkIndex"]), str(chunk["contentHash"])) for chunk in current]
    stored = [tuple(pair) for pair in candidate.get("chunkHashes") or []]
    return live == stored


async def compare_materials(
    session: Session,
    user_id: uuid.UUID,
    *,
    goal: dict,
    plan_id: str | None,
    document_ids: list[str],
    links: list[str],
    link_reader,
    advisor,
    has_model: bool,
) -> dict:
    comparison_id = secrets.token_urlsafe(18)
    material_comparison_store.claim(user_id, comparison_id)
    plan_draft_store.block_confirm(user_id)
    if plan_id:
        plan = _owned_plan(session, user_id, plan_id)
        goal = _snapshot_from_plan(plan)
    else:
        _require_new_goal(goal)
    documents = [doc_id.strip() for doc_id in document_ids if doc_id and doc_id.strip()]
    urls = [url.strip() for url in links if url and url.strip()]
    if not documents and not urls:
        raise MaterialComparisonError(400, "NOTHING_TO_COMPARE", "还没有可以比较的文档或链接")
    candidates = [_document_candidate(session, user_id, doc_id) for doc_id in documents]
    for index, url in enumerate(urls):
        try:
            material = await link_reader(url)
        except Exception:
            material = None
        candidates.append(_link_candidate(url, material, index))
    suggestion = {"status": "not_called", "text": None}
    if has_model and advisor is not None:
        try:
            text = await advisor(_model_input(candidates, goal), goal)
        except Exception:
            suggestion = {"status": "failed", "text": None}
        else:
            suggestion = {"status": "suggested", "text": None if text is None else str(text)}
    item = MaterialComparison(
        user_id=user_id,
        comparison_id=comparison_id,
        created_at=_now(),
        goal=goal,
        plan_id=plan_id,
        candidates=candidates,
        suggestion=suggestion,
    )
    material_comparison_store.publish(item)
    return _public(item)


def _goal_changed(left: dict, right: dict) -> bool:
    keys = ("goalName", "goalDate", "currentLevel", "dailyMinutes", "completionCriterion")
    return any(left.get(key) != right.get(key) for key in keys)


def select_material(
    session: Session,
    user_id: uuid.UUID,
    comparison_id: str,
    candidate_id: str,
    submitted_goal: dict | None,
) -> dict:
    item = material_comparison_store.get(comparison_id, user_id)
    if item is None:
        raise MaterialComparisonError(404, "COMPARISON_NOT_FOUND", "这次比较不存在，请重新比较")
    if _now() - item.created_at > COMPARISON_TTL:
        raise MaterialComparisonError(409, "COMPARISON_EXPIRED", "这次比较已过期，请重新比较")
    if item.plan_id:
        plan = _owned_plan(session, user_id, item.plan_id)
        if _goal_changed(item.goal, _snapshot_from_plan(plan)):
            raise MaterialComparisonError(409, "GOAL_CHANGED", "规划目标已变化，请重新比较")
    elif submitted_goal is None or _goal_changed(item.goal, submitted_goal):
        raise MaterialComparisonError(409, "GOAL_CHANGED", "目标已变化，请重新比较")
    candidate = next((row for row in item.candidates if row["candidateId"] == candidate_id), None)
    if candidate is None:
        raise MaterialComparisonError(404, "CANDIDATE_NOT_FOUND", "这次比较里没有这份资料")
    if candidate["readStatus"] == "failed" or (
        candidate["kind"] == "document" and not candidate.get("chunkHashes")
    ):
        raise MaterialComparisonError(409, "SOURCE_UNAVAILABLE", "这份资料没有可用正文，不能选择")
    if not _hashes_still_match(session, user_id, candidate):
        item.selected_id = None
        raise MaterialComparisonError(409, "SOURCE_CHANGED", "资料已变化或已删除，请重新比较")
    item.selected_id = candidate_id
    return _public(item)
