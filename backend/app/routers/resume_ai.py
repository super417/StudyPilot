"""Magic-resume compatible AI routes backed by personal-center API config."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import User
from app.routers.dependencies import get_current_user
from app.services import resume_ai_proxy_service
from app.services.resume_ai_proxy_service import ResumeAiProxyError

router = APIRouter(tags=["resume-ai"])


def _error_response(error: ResumeAiProxyError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status,
        content={
            "code": error.code,
            "error": {"code": error.code, "message": error.message},
        },
    )


def _body_field(body: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in body:
            return body[key]
    return None


@router.post("/api/ai-test")
async def ai_test(
    request: Request,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    body = await request.json()
    connection = _body_field(body, "connection")
    try:
        return await resume_ai_proxy_service.test_connection(
            session, user.id, connection
        )
    except ResumeAiProxyError as error:
        return _error_response(error)


@router.post("/api/grammar")
async def grammar(
    request: Request,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    body = await request.json()
    content = _body_field(body, "content")
    connection = _body_field(body, "connection")
    try:
        return await resume_ai_proxy_service.check_grammar(
            session, user.id, content, connection
        )
    except ResumeAiProxyError as error:
        return _error_response(error)


@router.post("/api/polish")
async def polish(
    request: Request,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    body = await request.json()
    content = _body_field(body, "content")
    custom = _body_field(body, "customInstructions", "custom_instructions") or ""
    connection = _body_field(body, "connection")
    try:
        chunks = await resume_ai_proxy_service.iter_polish_chunks(
            session, user.id, content, str(custom), connection
        )

        async def stream():
            async for piece in chunks:
                yield piece

        return StreamingResponse(
            stream(),
            media_type="text/plain; charset=utf-8",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    except ResumeAiProxyError as error:
        return _error_response(error)


@router.post("/api/models")
async def models(
    request: Request,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    body = await request.json()
    connection = {
        "provider": _body_field(body, "provider"),
        "apiKey": _body_field(body, "apiKey"),
        "baseUrl": _body_field(body, "baseUrl"),
    }
    try:
        return await resume_ai_proxy_service.list_models_for_resume(
            session, user.id, connection
        )
    except ResumeAiProxyError as error:
        return _error_response(error)
