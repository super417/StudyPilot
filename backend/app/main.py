from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.routers.api_config import router as api_config_router
from app.routers.assistant import router as assistant_router
from app.routers.auth import router as auth_router
from app.routers.conversations import router as conversations_router
from app.routers.courses import router as courses_router
from app.routers.dependencies import AuthenticationRequiredError
from app.routers.documents import router as documents_router
from app.routers.health import router as health_router
from app.routers.mistakes import router as mistakes_router
from app.routers.notes import router as notes_router
from app.routers.phases import router as phases_router
from app.routers.plans import router as plans_router
from app.routers.practice import router as practice_router
from app.routers.profile import router as profile_router
from app.routers.study import router as study_router
from app.routers.weekly_reviews import router as weekly_reviews_router
from app.services.session_service import COOKIE_NAME

app = FastAPI(title="StudyPilot API", version="0.1.0")
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(profile_router)
app.include_router(api_config_router)
app.include_router(documents_router)
app.include_router(plans_router)
app.include_router(practice_router)
app.include_router(phases_router)
app.include_router(study_router)
app.include_router(mistakes_router)
app.include_router(notes_router)
app.include_router(courses_router)
app.include_router(weekly_reviews_router)
app.include_router(assistant_router)
app.include_router(conversations_router)


@app.exception_handler(AuthenticationRequiredError)
async def authentication_required_handler(
    _: Request, error: AuthenticationRequiredError
) -> JSONResponse:
    response = JSONResponse(
        status_code=401,
        content={
            "status": "error",
            "code": error.code,
            "message": error.message,
        },
    )
    if error.clear_cookie:
        response.delete_cookie(COOKIE_NAME)
    return response
