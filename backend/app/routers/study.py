"""Study routes: check-ins, daily tasks, and overview metrics (needs 15/16).

Plain REST endpoints (no AI call, no SSE). All three areas are scoped to the
authenticated user, and every error collapses to the shared
``{status, code, message}`` JSON shape used elsewhere. Query dates arrive as
``YYYY-MM-DD``; a missing or malformed date is a ``VALIDATION`` 400.
"""

from datetime import date
import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import DailyTask, User
from app.routers.dependencies import get_current_user
from app.services import checkin_service, metrics_service, task_service
from app.services.checkin_service import CheckInValidationError
from app.services.task_service import NoPlanError, TaskNotFoundError, TaskStatusValidationError

router = APIRouter(prefix="/api", tags=["study"])

_VALIDATION_CODE = "VALIDATION"


def _to_camel(field_name: str) -> str:
    head, *tail = field_name.split("_")
    return head + "".join(part.title() for part in tail)


def _json_error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "code": code, "message": message},
    )


def _parse_date(value: str | None) -> date | None:
    """Parse a required ``YYYY-MM-DD`` query value; ``None`` on missing/invalid."""
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


class CheckInPayload(BaseModel):
    """Check-in request fields (camelCase from the frontend)."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    check_date: str = ""
    duration_minutes: int | None = None
    difficulty: int | None = None
    energy: int | None = None
    note: str | None = None


class AddTaskPayload(BaseModel):
    """Add one task on a date of the latest plan."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    task_date: str = ""
    description: str | None = None


class TaskStatusPayload(BaseModel):
    """Body for the daily-task status toggle."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    status: str = ""


def _task_result(task: DailyTask) -> dict:
    return {
        "id": str(task.id),
        "phaseId": str(task.phase_id),
        "taskDate": task.task_date.isoformat(),
        "weekLabel": task.week_label,
        "description": task.description,
        "status": task.status,
    }


@router.post("/check-ins", status_code=201)
def create_check_in_route(
    payload: CheckInPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    check_date = _parse_date(payload.check_date)
    if check_date is None:
        return _json_error(400, _VALIDATION_CODE, "打卡日期不合法")
    if payload.duration_minutes is None or payload.difficulty is None or payload.energy is None:
        return _json_error(400, _VALIDATION_CODE, "打卡数据不完整")

    try:
        check_in = checkin_service.create_check_in(
            session,
            user.id,
            check_date,
            payload.duration_minutes,
            payload.difficulty,
            payload.energy,
            payload.note,
        )
    except CheckInValidationError as error:
        return _json_error(400, error.code, str(error))

    return JSONResponse(
        status_code=201,
        content={"status": "ok", "checkInId": str(check_in.id)},
    )


@router.post("/daily-tasks")
def add_today_task_route(
    payload: AddTaskPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    task_date = _parse_date(payload.task_date)
    if task_date is None:
        return _json_error(400, _VALIDATION_CODE, "日期参数不合法")
    try:
        task, created = task_service.add_today_task(
            session, user.id, task_date, payload.description
        )
    except NoPlanError as error:
        return _json_error(404, error.code, str(error))
    return JSONResponse(
        status_code=201 if created else 200,
        content={"status": "ok", "task": _task_result(task)},
    )


@router.get("/daily-tasks")
def list_daily_tasks_route(
    date: str | None = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    task_date = _parse_date(date)
    if task_date is None:
        return _json_error(400, _VALIDATION_CODE, "日期参数不合法")

    tasks = task_service.get_daily_tasks(session, user.id, task_date)
    return JSONResponse(
        status_code=200,
        content={"status": "ok", "tasks": [_task_result(task) for task in tasks]},
    )


@router.patch("/daily-tasks/{task_id}/status")
def set_task_status_route(
    task_id: str,
    payload: TaskStatusPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    try:
        parsed_task_id = uuid.UUID(task_id)
    except (ValueError, AttributeError, TypeError):
        return _json_error(404, TaskNotFoundError.code, str(TaskNotFoundError()))

    try:
        task, phase = task_service.set_task_status(
            session, user.id, parsed_task_id, payload.status
        )
    except TaskStatusValidationError as error:
        return _json_error(400, error.code, str(error))
    except TaskNotFoundError as error:
        return _json_error(404, error.code, str(error))

    return JSONResponse(
        status_code=200,
        content={
            "status": "ok",
            "task": {"id": str(task.id), "status": task.status},
            "phase": {"id": str(phase.id), "progressPercent": phase.progress_percent},
        },
    )


@router.get("/metrics/overview")
def metrics_overview_route(
    today: str | None = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    local_today = _parse_date(today)
    if local_today is None:
        return _json_error(400, _VALIDATION_CODE, "today 参数不合法")

    metrics = metrics_service.compute_overview(session, user.id, local_today)
    return JSONResponse(
        status_code=200,
        content={
            "status": "ok",
            "totalMinutes": metrics.total_minutes,
            "streakDays": metrics.streak_days,
            "remainingDays": metrics.remaining_days,
            "phaseProgress": {
                "completed": metrics.phase_progress_completed,
                "total": metrics.phase_progress_total,
            },
            "todayStatus": metrics.today_status,
        },
    )
