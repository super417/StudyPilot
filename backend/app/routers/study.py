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
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import DailySelection, DailyTask, MasteryEvidence, Plan, PracticeQuestion, User
from app.routers.dependencies import get_current_user
from app.services import checkin_service, direction_service, metrics_service, task_service
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

    task_id: uuid.UUID | None = None
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


class DailySelectionPayload(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)
    date: str = ""
    task_ids: list[str] = []
    minutes: int = 30


@router.get('/daily-selection')
def get_daily_selection(date: str, user: User = Depends(get_current_user), session: Session = Depends(get_db)):
    day = _parse_date(date)
    if day is None:
        return _json_error(400, _VALIDATION_CODE, '日期参数不合法')
    rows = session.execute(select(DailySelection, DailyTask).join(DailyTask, DailySelection.task_id == DailyTask.id).where(DailySelection.user_id == user.id, DailySelection.study_date == day).order_by(DailySelection.position)).all()
    items = []
    for item, task in rows:
        questions = list(session.scalars(select(PracticeQuestion).where(PracticeQuestion.daily_selection_id == item.id, PracticeQuestion.user_id == user.id)))
        results = []
        for question in questions:
            evidence = session.scalar(select(MasteryEvidence).where(MasteryEvidence.question_id == question.id, MasteryEvidence.user_id == user.id, MasteryEvidence.evidence_type == 'quiz').order_by(MasteryEvidence.created_at.desc(), MasteryEvidence.id.desc()).limit(1))
            results.append(evidence.result if evidence else None)
        state = 'done' if task.status == 'done' else 'reinforce' if any(result in ('wrong', 'partial') for result in results) else 'verify' if item.learned else 'today'
        items.append({**_task_result(task), 'learned': item.learned, 'learningState': state})
    return {'status': 'ok', 'tasks': items, 'minutes': rows[0][0].minutes if rows else None}


@router.post('/daily-selection/{task_id}/learned')
def mark_selection_learned(task_id: str, date: str, user: User = Depends(get_current_user), session: Session = Depends(get_db)):
    day = _parse_date(date)
    try:
        task_uuid = uuid.UUID(task_id)
    except (ValueError, TypeError, AttributeError):
        return _json_error(404, 'NOT_FOUND', '今日任务不存在')
    item = session.scalar(select(DailySelection).join(DailyTask, DailyTask.id == DailySelection.task_id).join(Plan, Plan.id == DailyTask.plan_id).where(DailySelection.user_id == user.id, Plan.user_id == user.id, DailySelection.study_date == day, DailySelection.task_id == task_uuid, DailyTask.status == 'pending'))
    if item is None:
        return _json_error(404, 'NOT_FOUND', '今日任务不存在')
    item.learned = True
    session.commit()
    return {'status': 'ok'}


@router.put('/daily-selection')
def put_daily_selection(payload: DailySelectionPayload, user: User = Depends(get_current_user), session: Session = Depends(get_db)):
    day = _parse_date(payload.date)
    try:
        ids = [uuid.UUID(value) for value in payload.task_ids]
    except (ValueError, TypeError, AttributeError):
        return _json_error(400, _VALIDATION_CODE, '任务参数不合法')
    if day is None or not ids or len(set(ids)) != len(ids) or not 5 <= payload.minutes <= 240:
        return _json_error(400, _VALIDATION_CODE, '请选择任务和有效时间')
    tasks = list(session.scalars(select(DailyTask).join(Plan, Plan.id == DailyTask.plan_id).where(Plan.user_id == user.id, DailyTask.id.in_(ids), DailyTask.status == 'pending')))
    if len(tasks) != len(ids) or len({task.plan_id for task in tasks}) != 1:
        return _json_error(400, _VALIDATION_CODE, '任务不存在或不可选择')
    existing = list(session.scalars(select(DailySelection).where(DailySelection.user_id == user.id, DailySelection.study_date == day)))
    by_task = {item.task_id: item for item in existing}
    for item in existing:
        if item.task_id not in ids and not item.learned:
            session.delete(item)
    for position, task_id in enumerate(ids):
        item = by_task.get(task_id)
        if item is None:
            item = DailySelection(user_id=user.id, task_id=task_id, study_date=day, learned=False)
            session.add(item)
        item.position = position
        item.minutes = payload.minutes
    session.commit()
    return get_daily_selection(payload.date, user, session)


def _task_result(task: DailyTask) -> dict:
    return {
        "id": str(task.id),
        "phaseId": str(task.phase_id),
        "taskDate": task.task_date.isoformat(),
        "weekLabel": task.week_label,
        "description": task.description,
        "status": task.status,
        "dueCarried": task.status == "carried" or task.carried_from_id is not None,
        **direction_service.task_resource_fields(task),
        "estimatedMinutes": task.estimated_minutes,
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
            task_id=payload.task_id,
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


@router.get("/phases/{phase_id}/tasks")
def list_phase_tasks_route(
    phase_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    """All daily tasks of one phase, oldest date first."""
    try:
        parsed = uuid.UUID(phase_id)
    except (ValueError, AttributeError, TypeError):
        return _json_error(404, TaskNotFoundError.code, str(TaskNotFoundError("阶段不存在")))
    try:
        tasks = task_service.get_phase_tasks(session, user.id, parsed)
    except TaskNotFoundError as error:
        return _json_error(404, error.code, str(error))
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
            "phase": {
                "id": str(phase.id),
                "progressPercent": task_service.phase_progress(session, phase.id),
            },
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
