"""Authenticated document upload route (requirements 11.5-11.9)."""

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import User
from app.routers.dependencies import get_current_user
from app.services import document_service
from app.services.document_service import (
    DocumentNotFoundError,
    DocumentParseError,
    UnsupportedFileTypeError,
)

router = APIRouter(prefix="/api/documents", tags=["documents"])


def _json_error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "code": code, "message": message},
    )


@router.post("", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    data = await file.read()
    try:
        doc_id, chunks = document_service.store_document(
            session, user.id, file.filename or "", data
        )
    except UnsupportedFileTypeError as error:
        return _json_error(415, error.code, "仅支持 PDF/DOCX/TXT/Markdown")
    except DocumentParseError as error:
        return _json_error(422, error.code, "文档解析失败或内容为空")
    return {"status": "ok", "docId": doc_id, "chunks": chunks}


@router.get("")
def list_documents(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    """List the authenticated user's uploaded documents (aggregated by docId)."""
    documents = document_service.list_user_documents(session, user.id)
    return {"status": "ok", "documents": documents}


@router.delete("/{doc_id}")
def delete_document(
    doc_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    try:
        removed = document_service.delete_document(session, user.id, doc_id)
    except DocumentNotFoundError as error:
        return _json_error(404, error.code, str(error))
    return {"status": "ok", "docId": doc_id, "removedChunks": removed}
