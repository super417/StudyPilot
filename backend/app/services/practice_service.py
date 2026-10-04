"""Practice questions generated from today's finished tasks, or uploaded by hand."""

from datetime import date, datetime, timezone
import json
import re
import uuid
from typing import Awaitable, Callable

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import DailyTask, Mistake, Phase, Plan, PracticeQuestion, UserDocument
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

QuestionGenerator = Callable[[list[str], str], dict | Awaitable[dict]]

_VALID_STATUS = ("pending", "correct", "wrong")


class PracticeNotFoundError(ValueError):
    code = "NOT_FOUND"

    def __init__(self, message: str = "练习题不存在") -> None:
        super().__init__(message)


class PracticeValidationError(ValueError):
    code = "VALIDATION"

    def __init__(self, message: str = "练习题内容不合法") -> None:
        super().__init__(message)


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


def set_status(
    session: Session,
    user_id: uuid.UUID,
    question_id: uuid.UUID,
    status: str,
    my_answer: str | None = None,
) -> PracticeQuestion:
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
    context = document_service.retrieve_document_chunks(session, user_id, doc_ids) if doc_ids else ""
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
            status="pending",
        )
        for item in questions
    ]
    session.add_all(rows)
    session.commit()
    for row in rows:
        session.refresh(row)
    return rows
