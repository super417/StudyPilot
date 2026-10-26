"""Resume editor document routes: per-user snapshot read/write."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import User
from app.routers.dependencies import get_current_user
from app.services import resume_document_service
from app.services.resume_document_service import ResumeDocumentValidationError


router = APIRouter(prefix="/api/resume-documents", tags=["resume-documents"])


def _json_error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "code": code, "message": message},
    )


class ResumeDocumentPayload(BaseModel):
    payload: str


@router.get("")
def get_resume_document_route(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    document = resume_document_service.get_document(session, user.id)
    return JSONResponse(status_code=200, content={"status": "ok", "document": document})


@router.put("")
def put_resume_document_route(
    body: ResumeDocumentPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    try:
        document = resume_document_service.save_document(session, user.id, body.payload)
    except ResumeDocumentValidationError as error:
        status_code = 413 if error.code == "PAYLOAD_TOO_LARGE" else 400
        return _json_error(status_code, error.code, error.message)
    return JSONResponse(status_code=200, content={"status": "ok", "document": document})
