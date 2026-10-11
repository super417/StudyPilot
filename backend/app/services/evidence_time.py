"""Locatable evidence and deterministic duration checks for plan adjustments.

Term overlap only proves a chunk was found. It does not prove the document
supports the model's conclusion. Literature support stays a suggestion.
"""

from __future__ import annotations

from datetime import date
import hashlib
import re
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import UserDocument

_CJK_RUN = re.compile(r"[\u4e00-\u9fff]{2,}")
_EN_WORD = re.compile(r"[A-Za-z][A-Za-z0-9_]{2,}")


def overlap_terms(query: str, content: str) -> list[str]:
    """Return sorted terms from ``query`` that occur in ``content``.

    Chinese: contiguous Han runs of at least two characters, plus each
    two-character window inside a longer run. English: case-insensitive
    words of at least three letters. No relevance score.
    """
    if not query or not content:
        return []
    found: set[str] = set()
    for run in _CJK_RUN.findall(query):
        if run in content:
            found.add(run)
        for index in range(len(run) - 1):
            piece = run[index : index + 2]
            if piece in content:
                found.add(piece)
    content_words = {word.casefold() for word in _EN_WORD.findall(content)}
    for word in _EN_WORD.findall(query):
        if word.casefold() in content_words:
            found.add(word.casefold())
    return sorted(found)


def parse_estimated_minutes(value: object) -> int | None:
    """Positive int, or None when the estimate is absent. Reject junk."""
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("预计分钟必须是正整数")
    if value <= 0:
        raise ValueError("预计分钟必须是正整数")
    return value


def select_chunk_hits(chunks: list[dict], query: str) -> list[dict]:
    """Keep chunks that share terms with ``query``. Preserve input order."""
    hits: list[dict] = []
    for chunk in chunks:
        terms = overlap_terms(query, str(chunk.get("content") or ""))
        if not terms:
            continue
        hits.append({**chunk, "matchedTerms": terms})
    return hits


def citations_in_prompt(hits: list[dict], prompt_text: str) -> list[dict]:
    """Drop hits whose stored snippet never entered the final prompt text."""
    kept: list[dict] = []
    for hit in hits:
        snippet = str(hit.get("snippet") or hit.get("content") or "")
        if snippet and snippet in prompt_text:
            kept.append(hit)
    return kept


def check_model_citations(
    candidates: list[dict], cited: list[dict] | None
) -> tuple[list[dict], list[dict]]:
    """Accept only citations that match a provided candidate.

    Returns ``(accepted, fabricated)``. Fabricated items are not replaced
    with a lookalike chunk.
    """
    allowed = {
        (str(item.get("docId")), int(item.get("chunkIndex")))
        for item in candidates
    }
    accepted: list[dict] = []
    fabricated: list[dict] = []
    for item in cited or []:
        key = (str(item.get("docId")), int(item.get("chunkIndex")))
        if key in allowed:
            accepted.append(item)
        else:
            fabricated.append(item)
    return accepted, fabricated


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def lookup_document_ref(
    session: Session, user_id: uuid.UUID, ref: dict
) -> str:
    """Current availability of a snapshot. Does not rebind by filename."""
    row = session.scalar(
        select(UserDocument).where(
            UserDocument.user_id == user_id,
            UserDocument.doc_id == str(ref.get("docId")),
            UserDocument.chunk_index == int(ref.get("chunkIndex")),
        )
    )
    if row is None:
        return "unavailable"
    expected = ref.get("contentHash")
    if expected and content_hash(row.content) != expected:
        return "unavailable"
    return "available"


def duration_report(
    dated_minutes: list[tuple[date, int | None]],
    cap: int,
    today: date,
    goal: date,
) -> dict:
    """Sum known minutes on today..goal. Unknown is not zero. Cap is inclusive."""
    by_day: dict[date, list[int | None]] = {}
    for task_date, minutes in dated_minutes:
        if task_date < today or task_date > goal:
            continue
        by_day.setdefault(task_date, []).append(minutes)
    days: list[dict] = []
    overall = "pass"
    for task_date in sorted(by_day):
        values = by_day[task_date]
        unknown = sum(1 for item in values if item is None)
        known = sum(item for item in values if item is not None)
        if unknown:
            result = "unknown"
        elif known > cap:
            result = "fail"
        else:
            result = "pass"
        if result == "fail":
            overall = "fail"
        elif result == "unknown" and overall != "fail":
            overall = "unknown"
        days.append(
            {
                "date": task_date.isoformat(),
                "knownMinutes": known,
                "unknownCount": unknown,
                "cap": cap,
                "result": result,
            }
        )
    return {"result": overall, "days": days}


def check_schedule_order(
    phases: list[dict],
    goal: date,
    protected_dates: list[date],
    today: date | None = None,
) -> str:
    """Phase bounds, task dates inside them, and goal vs kept future history.

    Overlapping phases are allowed. Unparseable dates fail. ``protected_dates``
    are kept tasks on today or later. Past history is omitted by the caller.
    """
    for phase in phases:
        try:
            start = date.fromisoformat(str(phase["start_date"]))
            end = date.fromisoformat(str(phase["end_date"]))
        except ValueError:
            return "fail"
        if start > end:
            return "fail"
        last_task: date | None = None
        for task in phase.get("daily_tasks") or []:
            raw_date = task.get("task_date") or task.get("taskDate")
            try:
                task_date = date.fromisoformat(str(raw_date))
            except ValueError:
                return "fail"
            if task_date < start or task_date > end or task_date > goal:
                return "fail"
            if today is not None and task_date < today:
                return "fail"
            if last_task is not None and task_date < last_task:
                return "fail"
            last_task = task_date
    for protected in protected_dates:
        if protected > goal:
            return "fail"
    return "pass"


def labeled_block(hit: dict) -> str:
    snippet = str(hit.get("snippet") or hit.get("content") or "")
    return f"[docId={hit.get('docId')} chunkIndex={hit.get('chunkIndex')}]\n{snippet}"


def snapshot_for_prompt(chunks: list[dict], query: str, render_prompt) -> tuple[str, list[dict]]:
    """Select chunks before the model call and keep only blocks the prompt contains.

    Later chunks are not pulled in after an earlier block stops fitting.
    Identical text does not stand in for a block whose own label was not sent.
    """
    hits = select_chunk_hits(chunks, query)
    kept: list[dict] = []
    for hit in hits:
        snippet = str(hit.get("content") or hit.get("snippet") or "")
        candidate = {**hit, "snippet": snippet, "content": snippet}
        trial = kept + [candidate]
        context = "\n".join(labeled_block(item) for item in trial)
        prompt = render_prompt(context)
        if labeled_block(candidate) not in prompt:
            break
        kept.append(candidate)
    context = "\n".join(labeled_block(item) for item in kept)
    return context, kept


PROMPT_EXCERPT_CHARS = 8000


def load_owned_chunks(
    session: Session, user_id: uuid.UUID, doc_ids: list[str]
) -> list[dict]:
    if not doc_ids:
        return []
    rows = session.scalars(
        select(UserDocument)
        .where(
            UserDocument.user_id == user_id,
            UserDocument.doc_id.in_(doc_ids),
        )
        .order_by(UserDocument.doc_id, UserDocument.chunk_index)
    )
    return [
        {
            "docId": row.doc_id,
            "chunkIndex": row.chunk_index,
            "filename": row.filename,
            "content": row.content,
            "snippet": row.content,
            "pageStart": row.page_start,
            "contentHash": content_hash(row.content),
        }
        for row in rows
    ]


def chunks_that_fit_excerpt(hits: list[dict], limit: int = PROMPT_EXCERPT_CHARS) -> list[dict]:
    """Keep only snippets that fit entirely in the prompt excerpt."""
    kept: list[dict] = []
    used = 0
    for hit in hits:
        snippet = str(hit.get("snippet") or hit.get("content") or "")
        if not snippet or used + len(snippet) > limit:
            continue
        used += len(snippet)
        kept.append({**hit, "snippet": snippet})
    return kept
