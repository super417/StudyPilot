"""Course routes: subject list for the profile card."""

import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import User
from app.routers.dependencies import get_current_user
from app.services import course_service
from app.services.course_service import CourseNotFoundError, CourseValidationError

router = APIRouter(prefix="/api/courses", tags=["courses"])


def _to_camel(field_name: str) -> str:
    head, *tail = field_name.split("_")
    return head + "".join(part.title() for part in tail)


def _json_error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "code": code, "message": message},
    )


def _parse_id(course_id: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(course_id)
    except (ValueError, AttributeError, TypeError):
        return None


class CoursePayload(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    name: str = ""
    status: str = "active"


class ChapterPayload(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    title: str = ""
    url: str = ""


class ChapterDonePayload(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    done: bool = False


@router.get("")
def list_courses_route(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    return JSONResponse(
        status_code=200,
        content={"status": "ok", **course_service.course_overview(session, user.id)},
    )


@router.post("", status_code=201)
def create_course_route(
    payload: CoursePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    try:
        overview = course_service.create_course(
            session, user.id, name=payload.name, status=payload.status
        )
    except CourseValidationError as error:
        return _json_error(400, error.code, str(error))
    return JSONResponse(status_code=201, content={"status": "ok", **overview})


@router.put("/{course_id}")
def update_course_route(
    course_id: str,
    payload: CoursePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    parsed = _parse_id(course_id)
    if parsed is None:
        return _json_error(404, CourseNotFoundError.code, str(CourseNotFoundError()))
    try:
        overview = course_service.update_course(
            session,
            user.id,
            parsed,
            name=payload.name,
            status=payload.status,
        )
    except CourseValidationError as error:
        return _json_error(400, error.code, str(error))
    except CourseNotFoundError as error:
        return _json_error(404, error.code, str(error))
    return JSONResponse(status_code=200, content={"status": "ok", **overview})


@router.delete("/{course_id}")
def delete_course_route(
    course_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    parsed = _parse_id(course_id)
    if parsed is None:
        return _json_error(404, CourseNotFoundError.code, str(CourseNotFoundError()))
    try:
        overview = course_service.delete_course(session, user.id, parsed)
    except CourseNotFoundError as error:
        return _json_error(404, error.code, str(error))
    return JSONResponse(status_code=200, content={"status": "ok", **overview})


@router.get("/{course_id}/chapters")
def list_chapters_route(
    course_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    parsed = _parse_id(course_id)
    if parsed is None:
        return _json_error(404, CourseNotFoundError.code, str(CourseNotFoundError()))
    try:
        payload = course_service.list_chapters(session, user.id, parsed)
    except CourseNotFoundError as error:
        return _json_error(404, error.code, str(error))
    return JSONResponse(status_code=200, content={"status": "ok", **payload})


@router.post("/{course_id}/chapters", status_code=201)
def create_chapter_route(
    course_id: str,
    payload: ChapterPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    parsed = _parse_id(course_id)
    if parsed is None:
        return _json_error(404, CourseNotFoundError.code, str(CourseNotFoundError()))
    try:
        body = course_service.create_chapter(
            session, user.id, parsed, title=payload.title, url=payload.url
        )
    except CourseValidationError as error:
        return _json_error(400, error.code, str(error))
    except CourseNotFoundError as error:
        return _json_error(404, error.code, str(error))
    return JSONResponse(status_code=201, content={"status": "ok", **body})


@router.patch("/{course_id}/chapters/{chapter_id}")
def set_chapter_done_route(
    course_id: str,
    chapter_id: str,
    payload: ChapterDonePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    parsed = _parse_id(course_id)
    chapter = _parse_id(chapter_id)
    if parsed is None or chapter is None:
        return _json_error(404, CourseNotFoundError.code, "章节不存在")
    try:
        body = course_service.set_chapter_done(
            session, user.id, parsed, chapter, done=payload.done
        )
    except CourseNotFoundError as error:
        return _json_error(404, error.code, str(error))
    return JSONResponse(status_code=200, content={"status": "ok", **body})


@router.delete("/{course_id}/chapters/{chapter_id}")
def delete_chapter_route(
    course_id: str,
    chapter_id: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> JSONResponse:
    parsed = _parse_id(course_id)
    chapter = _parse_id(chapter_id)
    if parsed is None or chapter is None:
        return _json_error(404, CourseNotFoundError.code, "章节不存在")
    try:
        body = course_service.delete_chapter(session, user.id, parsed, chapter)
    except CourseNotFoundError as error:
        return _json_error(404, error.code, str(error))
    return JSONResponse(status_code=200, content={"status": "ok", **body})
