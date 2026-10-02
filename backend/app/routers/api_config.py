"""Authenticated CRUD routes for a user's encrypted API configuration."""

from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.crypto import decrypt
from app.core.database import get_db
from app.models.entities import ApiConfig, User
from app.services import api_config_service
from app.services.api_config_service import (
    ApiConfigAlreadyExistsError,
    ApiConfigFieldValidationError,
    ApiConfigModelsFetchError,
    ApiConfigNotFoundError,
    ApiConfigValidationError,
    ApiConfigVerificationError,
    ApiConfigVerificationTimeoutError,
)
from app.routers.dependencies import get_current_user


router = APIRouter(prefix="/api/api-config", tags=["api-config"])
Verifier = Callable[[str, str, str], Awaitable[bool]]


def _to_camel(field_name: str) -> str:
    head, *tail = field_name.split("_")
    return head + "".join(part.title() for part in tail)


class ApiConfigPayload(BaseModel):
    """API-config request fields with the frontend's camelCase aliases."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    api_key: str = ""
    model_type: str = ""
    base_url: str = ""


def get_api_config_verifier() -> Verifier | None:
    """Return the default verifier; tests may override this dependency."""
    return None


def _json_error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "code": code, "message": message},
    )


def _config_result(config: ApiConfig) -> dict:
    try:
        api_key = decrypt(config.api_key_cipher)
    except Exception:
        return _json_error(
            502,
            "CRED_UNAVAILABLE",
            "stored API credentials are unavailable",
        )

    return {
        "status": "ok",
        "apiKeyMasked": api_config_service.mask_api_key(api_key),
        "modelType": config.model_type,
        "baseUrl": config.base_url,
        "isVerified": bool(config.is_verified),
    }


def _service_error(error: ValueError) -> JSONResponse:
    if isinstance(error, ApiConfigAlreadyExistsError):
        return _json_error(409, error.code, "API configuration already exists")
    if isinstance(error, ApiConfigNotFoundError):
        return _json_error(404, error.code, "API configuration does not exist")
    if isinstance(error, ApiConfigVerificationTimeoutError):
        return _json_error(504, error.code, "API configuration verification timed out")
    if isinstance(error, ApiConfigVerificationError):
        return _json_error(400, error.code, "API configuration verification failed")
    if isinstance(error, ApiConfigModelsFetchError):
        return _json_error(502, error.code, str(error) or "无法获取可用模型列表")
    if isinstance(error, ApiConfigValidationError):
        return _json_error(400, error.code, "base URL must start with http:// or https://")
    if isinstance(error, ApiConfigFieldValidationError):
        return _json_error(400, error.code, str(error))
    raise error


class ModelsQueryPayload(BaseModel):
    """Optional draft credentials for listing models before save."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    api_key: str = ""
    base_url: str = ""


@router.post("/models")
async def list_api_models(
    payload: ModelsQueryPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    """List provider models via OpenAI-compatible GET /models.

    Prefer draft ``apiKey`` + ``baseUrl`` from the form; otherwise decrypt the
    stored configuration. The plaintext key never appears in the response.
    """
    api_key = (payload.api_key or "").strip()
    base_url = (payload.base_url or "").strip()
    config = None

    if not api_key or not base_url:
        config = api_config_service.get_api_config(session, user.id)
        if config is None:
            return _json_error(404, "NO_API_CONFIG", "API configuration does not exist")
        if not api_key:
            try:
                api_key = decrypt(config.api_key_cipher)
            except Exception:
                return _json_error(
                    502,
                    "CRED_UNAVAILABLE",
                    "stored API credentials are unavailable",
                )
        if not base_url:
            base_url = config.base_url

    normalized = api_config_service.normalize_base_url(base_url)
    try:
        models = await api_config_service.list_remote_models(api_key, normalized)
    except ValueError as error:
        return _service_error(error)

    # Persist corrected API host (e.g. platform.deepseek.com → api.deepseek.com)
    # so chat/completions also hit the real endpoint.
    if config is None:
        config = api_config_service.get_api_config(session, user.id)
    if config is not None and config.base_url.rstrip("/") != normalized:
        config.base_url = normalized
        try:
            session.commit()
        except Exception:
            session.rollback()

    return {"status": "ok", "models": models, "baseUrl": normalized}


@router.post("", status_code=201)
async def create_api_config(
    payload: ApiConfigPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
    verifier: Verifier | None = Depends(get_api_config_verifier),
):
    try:
        config = await api_config_service.save_api_config(
            session,
            user.id,
            payload.api_key,
            payload.model_type,
            payload.base_url,
            verifier,
        )
    except ValueError as error:
        return _service_error(error)
    return _config_result(config)


@router.get("")
def read_api_config(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    config = api_config_service.get_api_config(session, user.id)
    if config is None:
        return _json_error(404, "NO_API_CONFIG", "API configuration does not exist")
    normalized = api_config_service.normalize_base_url(config.base_url)
    if normalized != config.base_url.rstrip("/"):
        config.base_url = normalized
        try:
            session.commit()
            session.refresh(config)
        except Exception:
            session.rollback()
    return _config_result(config)


async def _update_api_config(
    payload: ApiConfigPayload,
    user: User,
    session: Session,
    verifier: Verifier | None,
):
    try:
        config = await api_config_service.update_api_config(
            session,
            user.id,
            payload.api_key,
            payload.model_type,
            payload.base_url,
            verifier,
        )
    except ValueError as error:
        return _service_error(error)
    return _config_result(config)


@router.put("")
async def replace_api_config(
    payload: ApiConfigPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
    verifier: Verifier | None = Depends(get_api_config_verifier),
):
    return await _update_api_config(payload, user, session, verifier)


@router.patch("")
async def patch_api_config(
    payload: ApiConfigPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
    verifier: Verifier | None = Depends(get_api_config_verifier),
):
    return await _update_api_config(payload, user, session, verifier)


@router.delete("")
def remove_api_config(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    try:
        api_config_service.delete_api_config(session, user.id)
    except ValueError as error:
        return _service_error(error)
    return {"status": "ok"}
