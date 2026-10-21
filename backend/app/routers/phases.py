"""Phase routes: card-level manual tweak of a single phase (needs 10.1, 10.3).

A plain REST PATCH — no AI call, so no verified API config is required and no
SSE framing is involved. The response echoes the updated phase in the same
camelCase shape the frontend ``Phase`` type uses, so the Roadmap can patch one
card without refetching the whole plan.
"""

import re
import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import Phase, Plan, User
from app.routers.dependencies import get_current_user
from app.services import planner_service, task_service
from app.services.planner_service import PhaseNotFoundError
from app.services.task_service import TaskNotFoundError

router = APIRouter(prefix="/api/phases", tags=["phases"])


def _to_camel(field_name: str) -> str:
    head, *tail = field_name.split("_")
    return head + "".join(part.title() for part in tail)


class PhasePatchPayload(BaseModel):
    """Partial phase edit; every field is optional (requirement 10.3).

    Omitted fields are left untouched — the route never treats "absent" as
    "clear", which is what makes the tweak strictly local to this one phase.
    """

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    name: str | None = None
    start_date: str | None = None
    end_date: str | None = None


def _json_error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "code": code, "message": message},
    )


def _phase_result(session: Session, phase: Phase) -> dict:
    return {
        "status": "ok",
        "phase": {
            "id": str(phase.id),
            "phaseIndex": phase.phase_index,
            "name": phase.name,
            "startDate": phase.start_date.isoformat(),
            "endDate": phase.end_date.isoformat(),
            "progressPercent": task_service.phase_progress(session, phase.id),
            "isCurrent": bool(phase.is_current),
            "isCompleted": task_service.phase_is_completed(session, phase.id),
        },
    }


def _split_phase_title(name: str) -> tuple[str, str | None]:
    match = re.search(r"^(.*?)([（(].+[）)])\s*$", name.strip())
    if not match:
        return name, None
    head = match.group(1).strip() or name
    return head, match.group(2).strip()


def _learning_plan_from_tasks(tasks: list) -> str:
    if not tasks:
        return "该阶段暂无学习计划"
    lines = ["本阶段学习计划："]
    for index, task in enumerate(tasks[:20], start=1):
        text = (task.description or "").strip() or "（无描述）"
        if len(text) > 120:
            text = text[:117] + "…"
        lines.append(f"{index}. [{task.task_date.isoformat()}] {text}")
    if len(tasks) > 20:
        lines.append(f"…共 {len(tasks)} 项任务")
    return "\n".join(lines)


@router.get("/{phase_id}/detail")
def phase_detail_route(
    phase_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    try:
        parsed = uuid.UUID(phase_id)
    except (ValueError, AttributeError, TypeError):
        return _json_error(404, PhaseNotFoundError.code, str(PhaseNotFoundError()))

    phase = session.scalar(
        select(Phase)
        .join(Plan, Plan.id == Phase.plan_id)
        .where(Phase.id == parsed, Plan.user_id == user.id)
    )
    if phase is None:
        return _json_error(404, PhaseNotFoundError.code, str(PhaseNotFoundError()))

    try:
        tasks = task_service.get_phase_tasks(session, user.id, parsed)
    except TaskNotFoundError as error:
        return _json_error(404, error.code, str(error))

    title, subtitle = _split_phase_title(phase.name)
    return JSONResponse(
        status_code=200,
        content={
            "status": "ok",
            "phaseId": str(phase.id),
            "phaseName": title,
            "subtitle": subtitle,
            "dateRange": f"{phase.start_date.isoformat()} ~ {phase.end_date.isoformat()}",
            "learningPlan": _learning_plan_from_tasks(tasks),
            "isCurrent": bool(phase.is_current),
            "isCompleted": task_service.phase_is_completed(session, phase.id),
            "progressPercent": task_service.phase_progress(session, phase.id),
            "tasks": [
                {
                    "id": str(task.id),
                    "taskDate": task.task_date.isoformat(),
                    "description": task.description,
                    "status": task.status,
                    "weekLabel": task.week_label,
                    "estimatedMinutes": task.estimated_minutes,
                    "phaseId": str(task.phase_id),
                    "resourceUrl": task.resource_url,
                    "chapterTitle": task.chapter_title,
                    "sectionTitle": task.section_title,
                }
                for task in tasks
            ],
        },
    )


@router.patch("/{phase_id}")
async def update_phase_route(
    phase_id: str,
    payload: PhasePatchPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    try:
        parsed_phase_id = uuid.UUID(phase_id)
    except (ValueError, AttributeError, TypeError):
        return _json_error(404, PhaseNotFoundError.code, str(PhaseNotFoundError()))

    try:
        phase = planner_service.update_phase(
            session,
            user.id,
            parsed_phase_id,
            {
                "name": payload.name,
                "start_date": payload.start_date,
                "end_date": payload.end_date,
            },
        )
    except PhaseNotFoundError as error:
        return _json_error(404, error.code, str(error))

    return JSONResponse(status_code=200, content=_phase_result(session, phase))
