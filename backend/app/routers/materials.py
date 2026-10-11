"""Compare materials and keep one temporary choice. Does not write a plan."""

from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import User
from app.routers.dependencies import get_current_user
from app.services.api_config_service import has_verified_api_config
from app.services.material_comparison_service import (
    MaterialComparisonError,
    compare_materials,
    default_material_advisor,
    select_material,
)
from app.services.material_task_service import preview_material_tasks
from app.services.video_link import fetch_link

router = APIRouter(prefix="/api/materials", tags=["materials"])


def _to_camel(field_name: str) -> str:
    head, *tail = field_name.split("_")
    return head + "".join(part.title() for part in tail)


def _strict_positive_int(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError("每日分钟必须是正整数")
    return value


def _optional_positive_int(value: object) -> int | None:
    if value is None:
        return None
    return _strict_positive_int(value)


StrictPositiveInt = Annotated[int, BeforeValidator(_strict_positive_int)]
OptionalPositiveInt = Annotated[int | None, BeforeValidator(_optional_positive_int)]


class ComparePayload(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    goal_name: str
    goal_date: str
    current_level: str
    daily_minutes: StrictPositiveInt
    completion_criterion: str | None = None
    plan_id: str | None = None
    document_ids: list[str] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)


class SelectPayload(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    candidate_id: str
    goal_name: str | None = None
    goal_date: str | None = None
    current_level: str | None = None
    daily_minutes: OptionalPositiveInt = None
    completion_criterion: str | None = None


def get_link_reader():
    return fetch_link


def get_material_task_model():
    """None uses the isolated preview prompt and the existing chat transport."""
    return None


def get_material_advisor(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    async def advise(facts: str, goal: dict) -> str:
        return await default_material_advisor(session, user.id, facts, goal)

    return advise


def _error(error: MaterialComparisonError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={
            "status": "error",
            "code": error.code,
            "message": error.message,
            "selectedCandidateId": None,
        },
    )


def _goal_from(payload: ComparePayload | SelectPayload) -> dict:
    criterion = payload.completion_criterion
    if isinstance(criterion, str):
        criterion = criterion.strip() or None
    return {
        "goalName": (payload.goal_name or "").strip(),
        "goalDate": payload.goal_date,
        "currentLevel": (payload.current_level or "").strip(),
        "dailyMinutes": payload.daily_minutes,
        "completionCriterion": criterion,
    }


@router.post("/compare")
async def compare_route(
    payload: ComparePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
    link_reader=Depends(get_link_reader),
    advisor=Depends(get_material_advisor),
):
    try:
        return await compare_materials(
            session,
            user.id,
            goal=_goal_from(payload),
            plan_id=payload.plan_id,
            document_ids=payload.document_ids,
            links=payload.links,
            link_reader=link_reader,
            advisor=advisor,
            has_model=has_verified_api_config(session, user.id),
        )
    except MaterialComparisonError as error:
        return _error(error)


@router.post("/comparisons/{comparison_id}/select")
def select_route(
    comparison_id: str,
    payload: SelectPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    try:
        return select_material(
            session,
            user.id,
            comparison_id,
            payload.candidate_id,
            _goal_from(payload),
        )
    except MaterialComparisonError as error:
        return _error(error)


class TaskPreviewPayload(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    goal_name: str
    goal_date: str
    current_level: str
    daily_minutes: StrictPositiveInt
    completion_criterion: str | None = None
    plan_id: str | None = None


@router.post("/comparisons/{comparison_id}/task-preview")
async def task_preview_route(
    comparison_id: str,
    payload: TaskPreviewPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
    model=Depends(get_material_task_model),
):
    try:
        return await preview_material_tasks(
            session,
            user.id,
            comparison_id,
            _goal_from(payload),
            payload.plan_id,
            model,
        )
    except MaterialComparisonError as error:
        return _error(error)


@router.post("/task-previews/{preview_id}/confirm")
def confirm_task_preview_route(preview_id: str, user: User = Depends(get_current_user)):
    del preview_id, user
    return _error(MaterialComparisonError(409, "CONFIRM_NOT_OPEN", "这一步还不能确认资料任务"))
