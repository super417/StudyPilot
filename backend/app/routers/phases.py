"""Phase routes: card-level manual tweak of a single phase (needs 10.1, 10.3).

A plain REST PATCH — no AI call, so no verified API config is required and no
SSE framing is involved. The response echoes the updated phase in the same
camelCase shape the frontend ``Phase`` type uses, so the Roadmap can patch one
card without refetching the whole plan.
"""

import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import Phase, User
from app.routers.dependencies import get_current_user
from app.services import planner_service
from app.services.planner_service import PhaseNotFoundError

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


def _phase_result(phase: Phase) -> dict:
    return {
        "status": "ok",
        "phase": {
            "id": str(phase.id),
            "phaseIndex": phase.phase_index,
            "name": phase.name,
            "startDate": phase.start_date.isoformat(),
            "endDate": phase.end_date.isoformat(),
            "progressPercent": phase.progress_percent,
            "isCurrent": bool(phase.is_current),
            "isCompleted": bool(phase.is_completed),
        },
    }


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

    return JSONResponse(status_code=200, content=_phase_result(phase))
