"""Planner SSE routes: generate + clarify + regenerate (needs 9.1-9.6, 10.2, 3.6).

Both endpoints stream Server-Sent Events. No credential material ever appears
in the response body — errors collapse to safe, generic codes/messages.

Card-level phase tweaking lives in ``app.routers.phases`` (a plain REST PATCH,
requirement 10.3).
"""

from typing import AsyncIterator
import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import User
from app.routers.dependencies import get_current_user
from app.services import document_service, planner_service
from app.services.api_config_service import (
    NoVerifiedApiConfigError,
    has_verified_api_config,
)
from app.services.plan_draft_store import plan_draft_store
from app.services.planner_service import (
    ClarifyOutcome,
    GenerateOutcome,
    PlanGenerationError,
    PlanGenerator,
    PlanNotFoundError,
    format_plan_sse,
    missing_fields,
)

router = APIRouter(prefix="/api/plans", tags=["plans"])

SSE_MEDIA_TYPE = "text/event-stream"

_DRAFT_NOT_FOUND_CODE = "DRAFT_NOT_FOUND"
_DRAFT_NOT_FOUND_MESSAGE = "追问会话不存在或已失效，请重新提交学习目标"
_NO_API_KEY_MESSAGE = "请先在设置中配置并验证 API"
_GENERATION_FORCED_NOTICE = "系统将基于你已提供的信息生成规划"
_SKIPPED_DOCS_NOTICE = "部分文档尚未就绪，已从本次规划依据中排除"
_EMPTY_INSTRUCTION_MESSAGE = "请描述你希望如何调整这份规划"


def _to_camel(field_name: str) -> str:
    head, *tail = field_name.split("_")
    return head + "".join(part.title() for part in tail)


class GeneratePayload(BaseModel):
    """Goal fields for plan generation (camelCase from the frontend)."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    goal_name: str | None = None
    goal_date: str | None = None
    current_level: str | None = None
    daily_minutes: int | None = None
    document_ids: list[str] | None = None
    reasoning_strength: str | None = None


class ClarifyPayload(BaseModel):
    """Optional supplemental goal fields supplied in a clarify reply."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    goal_name: str | None = None
    goal_date: str | None = None
    current_level: str | None = None
    daily_minutes: int | None = None
    document_ids: list[str] | None = None
    reasoning_strength: str | None = None


class RegeneratePayload(BaseModel):
    """Conversational edit request (requirement 10.2).

    ``message`` is the user's natural-language instruction ("把每天时间改成 3
    小时"). The four goal fields are optional overrides: any field left out is
    carried over from the stored plan rather than cleared.
    """

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    message: str = ""
    goal_name: str | None = None
    goal_date: str | None = None
    current_level: str | None = None
    daily_minutes: int | None = None
    document_ids: list[str] | None = None
    reasoning_strength: str | None = None


def get_plan_generator() -> PlanGenerator | None:
    """Injectable plan generator; overridden in tests. ``None`` = default."""
    return None


def _phase_dict(phase) -> dict:
    return {
        "id": str(phase.id),
        "phaseIndex": phase.phase_index,
        "name": phase.name,
        "startDate": phase.start_date.isoformat(),
        "endDate": phase.end_date.isoformat(),
        "progressPercent": phase.progress_percent,
        "isCurrent": bool(phase.is_current),
        "isCompleted": bool(phase.is_completed),
    }


@router.get("/latest")
def latest_plan_route(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    """Return the user's latest plan with ordered phases, or an empty marker."""
    plan = planner_service.get_latest_plan(session, user.id)
    if plan is None:
        return JSONResponse(
            status_code=200,
            content={"status": "ok", "plan": None, "phases": [], "empty": True},
        )
    phases = planner_service.list_phases_for_plan(session, plan.id)
    return JSONResponse(
        status_code=200,
        content={
            "status": "ok",
            "empty": False,
            "plan": {
                "id": str(plan.id),
                "goalName": plan.goal_name,
                "subtitle": plan.current_level,
                "startDate": plan.start_date.isoformat(),
                "goalDate": plan.goal_date.isoformat(),
                "currentLevel": plan.current_level,
                "dailyMinutes": plan.daily_minutes,
                "totalPhases": plan.total_phases,
                "updatedAt": plan.updated_at.isoformat(),
            },
            "phases": [_phase_dict(p) for p in phases],
        },
    )


def _fields_from(
    payload: GeneratePayload | ClarifyPayload | RegeneratePayload,
) -> dict[str, object]:
    """Collect the four goal fields (excluding documentIds) as camelCase keys."""
    fields: dict[str, object] = {
        "goalName": payload.goal_name,
        "goalDate": payload.goal_date,
        "currentLevel": payload.current_level,
        "dailyMinutes": payload.daily_minutes,
    }
    if payload.reasoning_strength:
        fields["reasoningStrength"] = payload.reasoning_strength
    return fields


def _error_frame(code: str, message: str) -> str:
    return format_plan_sse(
        planner_service.PLAN_SSE_ERROR_EVENT, {"code": code, "message": message}
    )


async def _generate_frames(
    session: Session,
    user_id,
    fields: dict[str, object],
    document_ids: list[str] | None,
    plan_generator: PlanGenerator | None,
    *,
    forced: bool,
) -> AsyncIterator[str]:
    """Run generation and yield the notice(s) + done/error frames.

    Ordering (requirement 9.7/9.8/17.4): a missing verified config short-circuits
    to NO_API_KEY before any document work; otherwise the forced-generation
    notice and the skipped-documents notice precede the terminal done frame.
    """
    # Fail fast on NO_API_KEY so it precedes any readiness notice.
    if not has_verified_api_config(session, user_id):
        yield _error_frame(NoVerifiedApiConfigError.code, _NO_API_KEY_MESSAGE)
        return

    if forced:
        yield format_plan_sse(
            planner_service.PLAN_SSE_NOTICE_EVENT,
            {"message": _GENERATION_FORCED_NOTICE},
        )

    # Readiness is read-only, so computing skipped ids here (to keep the notice
    # ahead of done) does not duplicate any side effect in generate_plan.
    _, skipped_docs = document_service.filter_ready_documents(
        session, user_id, document_ids
    )
    if skipped_docs:
        yield format_plan_sse(
            planner_service.PLAN_SSE_NOTICE_EVENT,
            {"skippedDocs": skipped_docs, "message": _SKIPPED_DOCS_NOTICE},
        )

    try:
        result = await planner_service.generate_plan(
            session, user_id, fields, document_ids, plan_generator
        )
    except NoVerifiedApiConfigError:
        yield _error_frame(NoVerifiedApiConfigError.code, _NO_API_KEY_MESSAGE)
        return
    except PlanGenerationError as error:
        yield _error_frame(PlanGenerationError.code, str(error))
        return
    except Exception:
        yield _error_frame(PlanGenerationError.code, "规划生成失败，请稍后重试")
        return

    yield format_plan_sse(
        planner_service.PLAN_SSE_DONE_EVENT,
        {
            "planId": str(result.plan_id),
            "phases": result.phases,
            "usedDocs": result.used_docs,
        },
    )


@router.post("/generate")
async def generate_plan_route(
    payload: GeneratePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
    plan_generator: PlanGenerator | None = Depends(get_plan_generator),
) -> StreamingResponse:
    fields = _fields_from(payload)
    document_ids = payload.document_ids
    missing = missing_fields(fields)

    async def stream() -> AsyncIterator[str]:
        if missing:
            # Not enough info: open a draft at round 1 and ask (9.2).
            draft_id = plan_draft_store.create(user.id, fields)
            yield format_plan_sse(
                planner_service.PLAN_SSE_CLARIFY_EVENT,
                {
                    "draftId": draft_id,
                    "round": 1,
                    "missing": missing,
                    "question": planner_service.clarify_question(missing),
                },
            )
            return

        async for frame in _generate_frames(
            session, user.id, fields, document_ids, plan_generator, forced=False
        ):
            yield frame

    return StreamingResponse(stream(), media_type=SSE_MEDIA_TYPE)


@router.post("/{draft_id}/clarify")
async def clarify_plan_route(
    draft_id: str,
    payload: ClarifyPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
    plan_generator: PlanGenerator | None = Depends(get_plan_generator),
) -> StreamingResponse:
    draft = plan_draft_store.get(draft_id, user.id)
    updates = _fields_from(payload)
    document_ids = payload.document_ids

    async def stream() -> AsyncIterator[str]:
        if draft is None:
            yield _error_frame(_DRAFT_NOT_FOUND_CODE, _DRAFT_NOT_FOUND_MESSAGE)
            return

        outcome = planner_service.advance_state(draft, updates)
        if isinstance(outcome, ClarifyOutcome):
            yield format_plan_sse(
                planner_service.PLAN_SSE_CLARIFY_EVENT,
                {
                    "draftId": draft_id,
                    "round": outcome.round,
                    "missing": outcome.missing,
                    "question": outcome.question,
                },
            )
            return

        # GenerateOutcome: consume the draft and generate.
        assert isinstance(outcome, GenerateOutcome)
        plan_draft_store.delete(draft_id)
        async for frame in _generate_frames(
            session,
            user.id,
            outcome.fields,
            document_ids,
            plan_generator,
            forced=outcome.forced,
        ):
            yield frame

    return StreamingResponse(stream(), media_type=SSE_MEDIA_TYPE)


@router.post("/{plan_id}/regenerate")
async def regenerate_plan_route(
    plan_id: str,
    payload: RegeneratePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
    plan_generator: PlanGenerator | None = Depends(get_plan_generator),
) -> StreamingResponse:
    """Re-generate an existing plan from a conversational edit request (10.1/10.2).

    Streams the same notice/done/error vocabulary as ``/generate``. ``planId`` in
    the done frame is the *same* id that was passed in: the plan row is updated
    in place rather than replaced, so the client's Roadmap keeps its reference.
    """
    instruction = (payload.message or "").strip()
    overrides = {
        key: value
        for key, value in _fields_from(payload).items()
        if value is not None
    }
    document_ids = payload.document_ids

    async def stream() -> AsyncIterator[str]:
        if not instruction and not overrides:
            yield _error_frame(
                PlanGenerationError.code, _EMPTY_INSTRUCTION_MESSAGE
            )
            return

        try:
            parsed_plan_id = uuid.UUID(plan_id)
        except (ValueError, AttributeError, TypeError):
            yield _error_frame(PlanNotFoundError.code, str(PlanNotFoundError()))
            return

        if not has_verified_api_config(session, user.id):
            yield _error_frame(NoVerifiedApiConfigError.code, _NO_API_KEY_MESSAGE)
            return

        _, skipped_docs = document_service.filter_ready_documents(
            session, user.id, document_ids
        )
        if skipped_docs:
            yield format_plan_sse(
                planner_service.PLAN_SSE_NOTICE_EVENT,
                {"skippedDocs": skipped_docs, "message": _SKIPPED_DOCS_NOTICE},
            )

        try:
            result = await planner_service.regenerate_plan(
                session,
                user.id,
                parsed_plan_id,
                instruction,
                overrides,
                document_ids,
                plan_generator,
            )
        except NoVerifiedApiConfigError:
            yield _error_frame(NoVerifiedApiConfigError.code, _NO_API_KEY_MESSAGE)
            return
        except PlanNotFoundError as error:
            yield _error_frame(PlanNotFoundError.code, str(error))
            return
        except PlanGenerationError as error:
            yield _error_frame(PlanGenerationError.code, str(error))
            return
        except Exception:
            yield _error_frame(PlanGenerationError.code, "规划生成失败，请稍后重试")
            return

        yield format_plan_sse(
            planner_service.PLAN_SSE_DONE_EVENT,
            {
                "planId": str(result.plan_id),
                "phases": result.phases,
                "usedDocs": result.used_docs,
            },
        )

    return StreamingResponse(stream(), media_type=SSE_MEDIA_TYPE)
