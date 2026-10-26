"""Authenticated, evidence-backed learning resume."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import User
from app.routers.dependencies import get_current_user
from app.services.resume_service import build_resume
from app.services.resume_polish_service import ResumePolishPayload, polish_resume_skills
from app.services.api_config_service import NoVerifiedApiConfigError
from app.services.ai_proxy import CredentialUnavailableError


router = APIRouter(prefix="/api/resume", tags=["resume"])


@router.get("")
def get_resume(
    week_start: date | None = None,
    week_end: date | None = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> dict:
    if week_start is not None and week_end is not None and week_start > week_end:
        raise HTTPException(status_code=422, detail="week_start must be before week_end")
    return build_resume(session, user.id, week_start, week_end)


@router.post("/polish")
async def polish_resume(
    payload: ResumePolishPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> dict:
    try:
        return await polish_resume_skills(session, user.id, payload.model_dump())
    except (ValueError, ValidationError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from None
    except NoVerifiedApiConfigError:
        raise HTTPException(status_code=400, detail="请先配置并验证模型 API") from None
    except CredentialUnavailableError:
        raise HTTPException(status_code=400, detail="模型凭证暂不可用") from None
    except RuntimeError:
        raise HTTPException(status_code=502, detail="模型润色暂不可用") from None
