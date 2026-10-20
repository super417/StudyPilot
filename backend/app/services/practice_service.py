"""Practice questions generated from today's finished tasks, or uploaded by hand."""

from datetime import date, datetime, timezone
import json
import re
import uuid
from typing import Awaitable, Callable

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    DailyTask,
    MasteryEvidence,
    Mistake,
    Phase,
    Plan,
    PracticeQuestion,
    ReinforceTaskEvidence,
    UserDocument,
)
from app.services import document_service
from app.services.ai_proxy import (
    CredentialUnavailableError,
    build_outbound_headers,
    resolve_credential,
)
from app.services.api_config_service import (
    NoVerifiedApiConfigError,
    require_verified_api_config,
)
from app.services.planner_service import PlanGenerationError
from app.services.retrieval import rank

QuestionGenerator = Callable[[list[str], str], dict | Awaitable[dict]]

_VALID_STATUS = ("pending", "correct", "wrong")
_SOURCE_MIN_COVERAGE = 0.25


class PracticeNotFoundError(ValueError):
    code = "NOT_FOUND"

    def __init__(self, message: str = "练习题不存在") -> None:
        super().__init__(message)


class PracticeValidationError(ValueError):
    code = "VALIDATION"

    def __init__(self, message: str = "练习题内容不合法") -> None:
        super().__init__(message)


class PracticeGradeError(RuntimeError):
    """The model call or its payload could not be graded. No evidence row exists."""

    code = "GRADE_FAILED"

    def __init__(self, message: str = "判分失败，没有写入掌握度证据") -> None:
        super().__init__(message)


class ExplanationInsufficientEvidenceError(ValueError):
    """No retrieved source text — do not call the model or write evidence."""

    code = "INSUFFICIENT_EVIDENCE"

    def __init__(self, message: str = "依据不足：没有可对照的原文") -> None:
        super().__init__(message)


_GRADE_RESULTS = ("correct", "partial", "wrong")
_CITATION_MARKERS = ("原文", "资料中")

def _visible_source_refs(question: str, refs: list | None) -> list | None:
    if not refs:
        return None
    visible = [
        ref
        for ref in refs
        if isinstance(ref, dict)
        and isinstance(ref.get("snippet"), str)
        and rank(
            question,
            [{"content": ref["snippet"]}],
            min_coverage=_SOURCE_MIN_COVERAGE,
        )
    ]
    return visible or None


def _question_json(row: PracticeQuestion) -> dict:
    return {
        "id": str(row.id),
        "source": row.source,
        "subject": row.subject,
        "question": row.question,
        "answer": row.answer,
        "explanation": row.explanation,
        "status": row.status,
        "createdAt": row.created_at.isoformat(),
        "sourceTaskId": str(row.source_task_id) if row.source_task_id else None,
        "sourceMistakeId": str(row.source_mistake_id) if row.source_mistake_id else None,
        "sourceRefs": _visible_source_refs(row.question, row.source_refs),
    }


def list_practice(session: Session, user_id: uuid.UUID, day: date) -> dict:
    rows = list(
        session.scalars(
            select(PracticeQuestion)
            .where(PracticeQuestion.user_id == user_id)
            .order_by(PracticeQuestion.created_at)
        )
    )
    questions = []
    review = []
    for row in rows:
        created = row.created_at.astimezone(timezone.utc).date() if row.created_at.tzinfo else row.created_at.date()
        if created == day:
            questions.append(_question_json(row))
        elif row.status == "pending" and created < day:
            review.append(_question_json(row))
    return {"questions": questions, "review": review}


def create_uploaded(
    session: Session,
    user_id: uuid.UUID,
    *,
    question: str,
    answer: str = "",
    explanation: str = "",
    subject: str = "",
) -> PracticeQuestion:
    text = question.strip()
    if not text:
        raise PracticeValidationError("请填写题目")
    row = PracticeQuestion(
        user_id=user_id,
        source="uploaded",
        subject=subject.strip()[:64],
        question=text,
        answer=answer.strip(),
        explanation=explanation.strip(),
        status="pending",
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def save_from_chat(
    session: Session,
    user_id: uuid.UUID,
    *,
    question: str,
    answer: str,
    explanation: str,
    subject: str,
    source_refs: list | None = None,
    today: date | None = None,
) -> PracticeQuestion:
    """Save a chat-generated question into today's practice list.

    Does NOT grade and does NOT write mastery evidence — the learner answers
    it in the practice book, where grade_answer supplies the evidence with a
    real source_ref. Keeping chat questions pending preserves the evidence
    chain (no untraceable rows).
    """
    text = question.strip()
    if not text:
        raise PracticeValidationError("题目不能为空")

    day = today or date.today()
    # DailyTask 无 created_at；按 id 取当天最早一条以绑定 source_task_id
    task = session.scalar(
        select(DailyTask)
        .join(Plan, Plan.id == DailyTask.plan_id)
        .where(
            Plan.user_id == user_id,
            DailyTask.task_date == day,
        )
        .order_by(DailyTask.id.asc())
        .limit(1)
    )
    if task is None:
        raise PracticeValidationError("今天没有学习任务，无法存入")

    subject_text = (subject or "").strip() or "综合"
    row = PracticeQuestion(
        user_id=user_id,
        source="uploaded",
        subject=subject_text[:64],
        question=text,
        answer=(answer or "").strip(),
        explanation=(explanation or "").strip(),
        source_task_id=task.id,
        source_refs=source_refs,
        status="pending",
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def set_status(
    session: Session,
    user_id: uuid.UUID,
    question_id: uuid.UUID,
    status: str,
    my_answer: str | None = None,
) -> PracticeQuestion:
    """Learner self-mark. Does not write mastery evidence and does not affect mastery.

    「做对了」must go through ``grade_answer``. This path only records the
    learner's own status, and a ``wrong`` mark still files a mistake.
    """
    if status not in _VALID_STATUS:
        raise PracticeValidationError("状态不合法")
    row = session.scalar(
        select(PracticeQuestion).where(
            PracticeQuestion.id == question_id,
            PracticeQuestion.user_id == user_id,
        )
    )
    if row is None:
        raise PracticeNotFoundError()
    row.status = status
    if status == "wrong" and row.source_mistake_id is None:
        mistake = Mistake(
            user_id=user_id,
            question=row.question,
            my_answer=(my_answer or "").strip() or None,
            why_wrong=None,
            correct_understanding=row.answer or None,
            subject=row.subject or "",
            review_status="pending",
        )
        session.add(mistake)
        session.flush()
        row.source_mistake_id = mistake.id
    session.commit()
    session.refresh(row)
    return row


def delete_question(session: Session, user_id: uuid.UUID, question_id: uuid.UUID) -> None:
    row = session.scalar(
        select(PracticeQuestion).where(
            PracticeQuestion.id == question_id,
            PracticeQuestion.user_id == user_id,
        )
    )
    if row is None:
        raise PracticeNotFoundError()
    session.delete(row)
    session.commit()


def _heuristic_questions(descriptions: list[str]) -> list[dict]:
    seeds = descriptions[:5] or ["今天学过的内容"]
    return [
        {
            "subject": "综合",
            "question": f"根据「{text}」，用自己的话写出一个关键结论，并举一个例子。",
            "answer": "结论要能对应任务里的章节或范围，例子要是自己做出来的。",
            "explanation": "对照任务描述里的动作和产出，确认能独立复述。",
        }
        for text in seeds
    ]


def _parse_questions(text: str) -> list[dict]:
    cleaned = (text or "").strip()
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned, re.IGNORECASE)
    if fenced:
        cleaned = fenced.group(1).strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start < 0 or end <= start:
            raise PlanGenerationError()
        parsed = json.loads(cleaned[start : end + 1])
    items = parsed.get("questions") if isinstance(parsed, dict) else None
    if not isinstance(items, list) or not items:
        raise PlanGenerationError()
    out = []
    for item in items[:10]:
        if not isinstance(item, dict) or not str(item.get("question") or "").strip():
            continue
        out.append(
            {
                "subject": str(item.get("subject") or "综合")[:64],
                "question": str(item["question"]).strip(),
                "answer": str(item.get("answer") or "").strip(),
                "explanation": str(item.get("explanation") or "").strip(),
            }
        )
    if not out:
        raise PlanGenerationError()
    return out


def _done_task_lines(session: Session, user_id: uuid.UUID, day: date) -> tuple[list[str], uuid.UUID | None]:
    rows = list(
        session.execute(
            select(DailyTask, Phase.name)
            .join(Plan, Plan.id == DailyTask.plan_id)
            .join(Phase, Phase.id == DailyTask.phase_id)
            .where(
                Plan.user_id == user_id,
                DailyTask.task_date == day,
                DailyTask.status == "done",
            )
        )
    )
    lines = [f"{name}：{task.description}" for task, name in rows]
    task_id = rows[0][0].id if rows else None
    return lines, task_id


async def _default_generator(session: Session, user_id: uuid.UUID, lines: list[str], context: str) -> dict:
    credential = resolve_credential(session, user_id)
    payload = {
        "model": credential.model_type,
        "stream": False,
        "messages": [
            {
                "role": "system",
                "content": (
                    "只输出 JSON："
                    '{"questions":[{"subject":"数学","question":"...","answer":"...","explanation":"..."}]}'
                    "。题目 5 到 10 道，紧扣给定的已完成任务，不要编造页码。"
                ),
            },
            {
                "role": "user",
                "content": "已完成任务：\n" + "\n".join(lines) + ("\n资料摘录：\n" + context[:4000] if context else ""),
            },
        ],
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            credential.base_url,
            headers={**build_outbound_headers(credential), "Content-Type": "application/json"},
            json=payload,
        )
    if response.status_code >= 400:
        raise PlanGenerationError()
    body = response.json()
    choices = body.get("choices") if isinstance(body, dict) else None
    text = ""
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        message = choices[0].get("message") or {}
        text = message.get("content") or ""
    return {"raw": text}


async def generate_for_day(
    session: Session,
    user_id: uuid.UUID,
    day: date,
    generator: QuestionGenerator | None = None,
) -> list[PracticeQuestion]:
    require_verified_api_config(session, user_id)
    lines, task_id = _done_task_lines(session, user_id, day)
    if not lines:
        return []
    doc_ids = list(
        session.scalars(
            select(UserDocument.doc_id).where(UserDocument.user_id == user_id).distinct()
        )
    )
    context, _ = (
        document_service.build_context(session, user_id, doc_ids, "\n".join(lines))
        if doc_ids
        else ("", [])
    )
    if context == "":
        return []
    try:
        if generator is None:
            produced = await _default_generator(session, user_id, lines, context)
            questions = _parse_questions(str(produced.get("raw") or ""))
        else:
            produced = generator(lines, context)
            if hasattr(produced, "__await__"):
                produced = await produced  # type: ignore[assignment]
            questions = _parse_questions(json.dumps(produced))
    except (NoVerifiedApiConfigError, CredentialUnavailableError):
        raise
    except Exception:
        questions = _heuristic_questions(lines)
    rows = [
        PracticeQuestion(
            user_id=user_id,
            source="generated",
            subject=item["subject"],
            question=item["question"],
            answer=item["answer"],
            explanation=item["explanation"],
            source_task_id=task_id,
            source_refs=_refs_for_question(session, user_id, doc_ids, item["question"]),
            status="pending",
        )
        for item in questions
    ]
    session.add_all(rows)
    session.commit()
    for row in rows:
        session.refresh(row)
    return rows


def _reinforce_tasks_for_phase(
    session: Session, user_id: uuid.UUID, phase_id: uuid.UUID
) -> tuple[Phase, list[DailyTask]]:
    phase = session.scalar(
        select(Phase)
        .join(Plan, Plan.id == Phase.plan_id)
        .where(Phase.id == phase_id, Plan.user_id == user_id)
    )
    if phase is None:
        raise PracticeNotFoundError("阶段不存在")
    task_ids = list(
        session.scalars(
            select(ReinforceTaskEvidence.task_id)
            .join(DailyTask, DailyTask.id == ReinforceTaskEvidence.task_id)
            .join(Plan, Plan.id == DailyTask.plan_id)
            .where(
                DailyTask.phase_id == phase_id,
                Plan.user_id == user_id,
            )
            .distinct()
        )
    )
    tasks = [session.get(DailyTask, task_id) for task_id in task_ids]
    return phase, [task for task in tasks if task is not None]


async def generate_reinforce_retest(
    session: Session,
    user_id: uuid.UUID,
    phase_id: uuid.UUID,
    generator: QuestionGenerator | None = None,
) -> list[PracticeQuestion]:
    """Generate practice questions anchored to reinforce tasks of one phase.

    Does not call ``_done_task_lines`` and does not select by date. Every
    written ``PracticeQuestion.source_task_id`` is a reinforce task id for
    ``phase_id``. No reinforce tasks → refuse without writing.
    """
    require_verified_api_config(session, user_id)
    phase, reinforce_tasks = _reinforce_tasks_for_phase(session, user_id, phase_id)
    if not reinforce_tasks:
        raise PracticeValidationError("该阶段没有补强任务，无法重测")
    lines = [f"{phase.name}：{task.description}" for task in reinforce_tasks]
    doc_ids = list(
        session.scalars(
            select(UserDocument.doc_id).where(UserDocument.user_id == user_id).distinct()
        )
    )
    context, _ = (
        document_service.build_context(session, user_id, doc_ids, "\n".join(lines))
        if doc_ids
        else ("", [])
    )
    if context == "":
        return []
    try:
        if generator is None:
            produced = await _default_generator(session, user_id, lines, context)
            questions = _parse_questions(str(produced.get("raw") or ""))
        else:
            produced = generator(lines, context)
            if hasattr(produced, "__await__"):
                produced = await produced  # type: ignore[assignment]
            questions = _parse_questions(json.dumps(produced))
    except (NoVerifiedApiConfigError, CredentialUnavailableError):
        raise
    except Exception:
        questions = _heuristic_questions(lines)
    rows = [
        PracticeQuestion(
            user_id=user_id,
            source="generated",
            subject=item["subject"],
            question=item["question"],
            answer=item["answer"],
            explanation=item["explanation"],
            source_task_id=reinforce_tasks[index % len(reinforce_tasks)].id,
            source_refs=_refs_for_question(session, user_id, doc_ids, item["question"]),
            status="pending",
        )
        for index, item in enumerate(questions)
    ]
    session.add_all(rows)
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    for row in rows:
        session.refresh(row)
    return rows


def _done_tasks_for_phase(
    session: Session, user_id: uuid.UUID, phase_id: uuid.UUID
) -> tuple[Phase, list[DailyTask]]:
    phase = session.scalar(
        select(Phase)
        .join(Plan, Plan.id == Phase.plan_id)
        .where(Phase.id == phase_id, Plan.user_id == user_id)
    )
    if phase is None:
        raise PracticeNotFoundError("阶段不存在")
    tasks = list(
        session.scalars(
            select(DailyTask)
            .where(DailyTask.phase_id == phase_id, DailyTask.status == "done")
            .order_by(DailyTask.task_date.asc(), DailyTask.id.asc())
        )
    )
    return phase, tasks


async def generate_phase_quiz(
    session: Session,
    user_id: uuid.UUID,
    phase_id: uuid.UUID,
    generator: QuestionGenerator | None = None,
) -> list[PracticeQuestion]:
    """Phase quiz: same shape as reinforce retest, sourced from done DailyTasks.

    ``source_task_id`` points at a done task of this phase so ``_knowledge_point``
    resolves to ``phase_id`` and mastery evidence feeds the dual rings.
    """
    require_verified_api_config(session, user_id)
    phase, done_tasks = _done_tasks_for_phase(session, user_id, phase_id)
    if not done_tasks:
        raise PracticeValidationError("该阶段还没有已完成的任务，无法测验")
    lines = [f"{phase.name}：{task.description}" for task in done_tasks]
    doc_ids = list(
        session.scalars(
            select(UserDocument.doc_id).where(UserDocument.user_id == user_id).distinct()
        )
    )
    context, _ = (
        document_service.build_context(session, user_id, doc_ids, "\n".join(lines))
        if doc_ids
        else ("", [])
    )
    if context == "":
        return []
    try:
        if generator is None:
            produced = await _default_generator(session, user_id, lines, context)
            questions = _parse_questions(str(produced.get("raw") or ""))
        else:
            produced = generator(lines, context)
            if hasattr(produced, "__await__"):
                produced = await produced  # type: ignore[assignment]
            questions = _parse_questions(json.dumps(produced))
    except (NoVerifiedApiConfigError, CredentialUnavailableError):
        raise
    except Exception:
        questions = _heuristic_questions(lines)
    rows = [
        PracticeQuestion(
            user_id=user_id,
            source="generated",
            subject=item["subject"],
            question=item["question"],
            answer=item["answer"],
            explanation=item["explanation"],
            source_task_id=done_tasks[index % len(done_tasks)].id,
            source_refs=_refs_for_question(session, user_id, doc_ids, item["question"]),
            status="pending",
        )
        for index, item in enumerate(questions)
    ]
    session.add_all(rows)
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    for row in rows:
        session.refresh(row)
    return rows


def _knowledge_point(
    session: Session, user_id: uuid.UUID, question: PracticeQuestion
) -> uuid.UUID | None:
    """Phase id of the question's source task. Unknown stays null — never guessed."""
    if question.source_task_id is None:
        return None
    return session.scalar(
        select(DailyTask.phase_id)
        .join(Plan, Plan.id == DailyTask.plan_id)
        .where(
            DailyTask.id == question.source_task_id,
            Plan.user_id == user_id,
        )
    )


def _refs_for_question(
    session: Session, user_id: uuid.UUID, doc_ids: list[str], question: str
) -> list[dict] | None:
    if not doc_ids:
        return None
    _, hits = document_service.build_context(
        session, user_id, doc_ids, question, min_coverage=_SOURCE_MIN_COVERAGE
    )
    return hits or None


def _source_for_grade(
    session: Session, user_id: uuid.UUID, query: str
) -> tuple[str, str | None]:
    doc_ids = list(
        session.scalars(
            select(UserDocument.doc_id).where(UserDocument.user_id == user_id).distinct()
        )
    )
    text, hits = document_service.build_context(
        session, user_id, doc_ids, query, min_coverage=_SOURCE_MIN_COVERAGE
    )
    if not hits:
        return "", None
    top = hits[0]
    return text, f"{top['docId']}#{top['chunkIndex']}"


def _parse_grade_payload(produced: object) -> dict:
    if not isinstance(produced, dict):
        raise PracticeGradeError("判分结果无法解析")
    result = produced.get("result")
    reason = produced.get("reason")
    if result not in _GRADE_RESULTS or not isinstance(reason, str) or not reason.strip():
        raise PracticeGradeError("判分结果无法解析")
    error_tag = produced.get("error_tag")
    if isinstance(error_tag, str):
        error_tag = error_tag.strip()[:64] or None
    else:
        error_tag = None
    return {"result": result, "reason": reason.strip(), "error_tag": error_tag}


def _string_list_or_empty(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _parse_explanation_payload(produced: object) -> dict:
    """Parse oral-explanation grading JSON. Does not reuse quiz payload rules."""
    if not isinstance(produced, dict):
        raise PracticeGradeError("判分结果无法解析")
    result = produced.get("result")
    reason = produced.get("reason")
    if result not in _GRADE_RESULTS or not isinstance(reason, str) or not reason.strip():
        raise PracticeGradeError("判分结果无法解析")
    error_tag = produced.get("error_tag")
    if isinstance(error_tag, str):
        error_tag = error_tag.strip()[:64] or None
    else:
        error_tag = None
    return {
        "result": result,
        "reason": reason.strip(),
        "error_tag": error_tag,
        "covered": _string_list_or_empty(produced.get("covered")),
        "missing": _string_list_or_empty(produced.get("missing")),
        "wrong": _string_list_or_empty(produced.get("wrong")),
    }

def _reason_for_storage(reason: str, source_ref: str | None) -> str:
    if source_ref is None and any(marker in reason for marker in _CITATION_MARKERS):
        return "没有可对照的材料，只根据题目和作答判断。"
    return reason


def _loads_model_json(
    text: str, parse: Callable[[object], dict] = _parse_grade_payload
) -> dict:
    raw = text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?", "", raw).strip()
        if raw.endswith("```"):
            raw = raw[: raw.rfind("```")].strip()
    try:
        body = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise PracticeGradeError("判分结果无法解析") from exc
    return parse(body)


async def _call_grade_model(
    session: Session,
    user_id: uuid.UUID,
    *,
    system: str,
    user_content: str,
    parse: Callable[[object], dict],
) -> dict:
    require_verified_api_config(session, user_id)
    credential = resolve_credential(session, user_id)
    payload = {
        "model": credential.model_type,
        "stream": False,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                credential.base_url,
                headers={
                    **build_outbound_headers(credential),
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except Exception as exc:
        raise PracticeGradeError("判分调用失败，没有写入掌握度证据") from exc
    if response.status_code >= 400:
        raise PracticeGradeError("判分调用失败，没有写入掌握度证据")
    try:
        body = response.json()
    except Exception as exc:
        raise PracticeGradeError("判分结果无法解析") from exc
    choices = body.get("choices") if isinstance(body, dict) else None
    text = ""
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        message = choices[0].get("message") or {}
        text = message.get("content") or ""
    return _loads_model_json(str(text), parse)


async def _default_grader(
    session: Session,
    user_id: uuid.UUID,
    question: str,
    answer: str,
    source_text: str,
) -> dict:
    excerpt = source_text.strip()
    return await _call_grade_model(
        session,
        user_id,
        system=(
            "只输出 JSON："
            '{"result":"correct","reason":"...","error_tag":""}'
            "。result 只能是 correct、partial、wrong。"
            "有摘录时 reason 依据摘录；摘录为空时不要写「原文」或「资料中」。"
        ),
        user_content=(
            f"题目：\n{question}\n作答：\n{answer}\n摘录：\n"
            + (excerpt[:4000] if excerpt else "（没有检索到可对照的摘录）")
        ),
        parse=_parse_grade_payload,
    )


async def _default_explanation_grader(
    session: Session,
    user_id: uuid.UUID,
    question: str,
    answer: str,
    source_text: str,
) -> dict:
    excerpt = source_text.strip()
    return await _call_grade_model(
        session,
        user_id,
        system=(
            "你扮演一个不懂该知识点的初学者：根据摘录追问并点评口述。"
            "只输出 JSON："
            '{"result":"correct","reason":"...","error_tag":"",'
            '"covered":["..."],"missing":["..."],"wrong":["..."]}'
            "。result 只能是 correct、partial、wrong。"
            "reason 必须引用检索原文。"
            "covered / missing / wrong 每条尽量带原文位置或摘录短句。"
        ),
        user_content=(
            f"题目：\n{question}\n口述：\n{answer}\n摘录：\n{excerpt[:4000]}"
        ),
        parse=_parse_explanation_payload,
    )


async def _grade_and_record(
    session: Session,
    user_id: uuid.UUID,
    question_id: uuid.UUID,
    answer_text: str,
    *,
    evidence_type: str,
    grader: Callable[..., dict | Awaitable[dict]] | None,
    default_grader: Callable[..., Awaitable[dict]],
    parse: Callable[[object], dict],
    require_source: bool,
) -> tuple[MasteryEvidence, dict]:
    answer = (answer_text or "").strip()
    if not answer:
        raise PracticeValidationError("请先写下你的作答")
    question = session.scalar(
        select(PracticeQuestion).where(
            PracticeQuestion.id == question_id,
            PracticeQuestion.user_id == user_id,
        )
    )
    if question is None:
        raise PracticeNotFoundError()
    source_text, source_ref = _source_for_grade(session, user_id, question.question)
    if require_source and not source_text.strip():
        raise ExplanationInsufficientEvidenceError()
    try:
        if grader is None:
            produced = await default_grader(
                session, user_id, question.question, answer, source_text
            )
        else:
            produced = grader(question.question, answer, source_text)
            if hasattr(produced, "__await__"):
                produced = await produced  # type: ignore[assignment]
        verdict = parse(produced)
    except PracticeGradeError:
        session.rollback()
        raise
    except (NoVerifiedApiConfigError, CredentialUnavailableError):
        session.rollback()
        raise
    except ExplanationInsufficientEvidenceError:
        session.rollback()
        raise
    except Exception as exc:
        session.rollback()
        raise PracticeGradeError("判分失败，没有写入掌握度证据") from exc

    row = MasteryEvidence(
        user_id=user_id,
        knowledge_point=_knowledge_point(session, user_id, question),
        evidence_type=evidence_type,
        result=verdict["result"],
        error_tag=verdict["error_tag"],
        answer_text=answer,
        grade_reason=_reason_for_storage(verdict["reason"], source_ref),
        source_ref=source_ref,
        question_id=question.id,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row, verdict


async def grade_answer(
    session: Session,
    user_id: uuid.UUID,
    question_id: uuid.UUID,
    answer_text: str,
    grader: Callable[..., dict | Awaitable[dict]] | None = None,
    *,
    evidence_type: str = "quiz",
) -> MasteryEvidence:
    """Grade one answer from retrieved source text and append one evidence row.

    A failed or unparseable model response writes nothing and raises.
    ``knowledge_point`` is the source task's phase id, or null when that
    cannot be derived. It is never inferred from the subject line.
    """
    row, _verdict = await _grade_and_record(
        session,
        user_id,
        question_id,
        answer_text,
        evidence_type=evidence_type,
        grader=grader,
        default_grader=_default_grader,
        parse=_parse_grade_payload,
        require_source=False,
    )
    return row


async def explain_answer(
    session: Session,
    user_id: uuid.UUID,
    question_id: uuid.UUID,
    answer_text: str,
    grader: Callable[..., dict | Awaitable[dict]] | None = None,
) -> tuple[MasteryEvidence, dict]:
    """Oral explanation grading. Writes ``evidence_type=explanation``.

    Empty retrieval short-circuits before any model call and writes nothing.
    """
    row, verdict = await _grade_and_record(
        session,
        user_id,
        question_id,
        answer_text,
        evidence_type="explanation",
        grader=grader,
        default_grader=_default_explanation_grader,
        parse=_parse_explanation_payload,
        require_source=True,
    )
    review = {
        "covered": verdict.get("covered") or [],
        "missing": verdict.get("missing") or [],
        "wrong": verdict.get("wrong") or [],
    }
    return row, review
