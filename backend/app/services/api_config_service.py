"""Validation, verification, and encrypted persistence for API configurations."""

import asyncio
from collections.abc import Awaitable, Callable
import uuid

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.crypto import encrypt
from app.models.entities import ApiConfig


class ApiConfigValidationError(ValueError):
    """Raised when an API configuration Base URL fails validation."""

    code = "INVALID_URL"


def validate_base_url(base_url: str) -> str:
    """Return the original Base URL when it starts with lowercase HTTP(S)."""
    if not isinstance(base_url, str) or not base_url.startswith(("http://", "https://")):
        raise ApiConfigValidationError(
            "base URL must start with http:// or https://"
        )
    return base_url


def normalize_base_url(base_url: str) -> str:
    """Map known non-API hosts to the real OpenAI-compatible API root.

    Users often paste DeepSeek console URLs such as
    ``https://platform.deepseek.com/api_keys`` (HTML dashboard). The API host is
    always ``https://api.deepseek.com`` (optional ``/v1``).
    """
    cleaned = validate_base_url(base_url).rstrip("/")
    lowered = cleaned.lower()
    if "platform.deepseek.com" in lowered:
        # Drop console paths like /api_keys; keep /v1 only when explicitly present.
        path = ""
        if lowered.rstrip("/").endswith("/v1") or "/v1/" in lowered.split("?", 1)[0]:
            path = "/v1"
        return f"https://api.deepseek.com{path}"
    return cleaned


def mask_api_key(api_key: str, mask_char: str = "*") -> str:
    """Mask an API key while leaving only its final four characters visible."""
    if not isinstance(mask_char, str) or len(mask_char) != 1:
        raise ValueError("mask_char must be a single character")

    if len(api_key) < 4:
        return mask_char * len(api_key)
    return mask_char * (len(api_key) - 4) + api_key[-4:]


class ApiConfigFieldValidationError(ValueError):
    """Raised when a required API configuration field is empty."""

    code = "VALIDATION"


class ApiConfigVerificationTimeoutError(ValueError):
    """Raised when external API configuration verification times out."""

    code = "VERIFY_TIMEOUT"


class ApiConfigVerificationError(ValueError):
    """Raised when external API configuration verification fails."""

    code = "VERIFY_FAILED"


class ApiConfigAlreadyExistsError(ValueError):
    """Raised when a user already has an API configuration."""

    code = "CONFIG_EXISTS"


class ApiConfigNotFoundError(ValueError):
    """Raised when a user has no API configuration to update or delete."""

    code = "NO_API_CONFIG"


class NoVerifiedApiConfigError(ValueError):
    """Raised when an AI operation has no verified API configuration."""

    code = "NO_API_KEY"

    def __init__(self, message: str = "a verified API configuration is required") -> None:
        super().__init__(message)


def _validate_required_field(value: str, field_name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ApiConfigFieldValidationError(f"{field_name} must not be empty")


def _is_user_config_unique_violation(error: IntegrityError) -> bool:
    """Identify only the ApiConfig.user_id unique constraint violation."""
    message = str(error.orig).lower()
    return "unique" in message and "user_id" in message


async def _verify_api_config(
    api_key: str,
    model_type: str,
    base_url: str,
    verifier: Callable[[str, str, str], Awaitable[bool]] | None,
) -> None:
    try:
        if verifier is not None:
            verified = await verifier(api_key, model_type, base_url)
        else:
            # Prefer OpenAI-compatible /models so HTML dashboards (e.g. DeepSeek
            # platform.*) cannot pass verification with a bare 200 page.
            models_url = candidate_models_urls(base_url)[0]
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                response = await client.get(
                    models_url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Accept": "application/json",
                        "X-Model-Type": model_type,
                    },
                )
            content_type = (response.headers.get("content-type") or "").lower()
            if "text/html" in content_type:
                verified = False
            elif response.status_code == 401 or response.status_code == 403:
                verified = False
            elif response.status_code == 404:
                # Some gateways omit /models; fall back to probing the base URL
                # but still reject HTML dashboards.
                async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                    probe = await client.get(
                        base_url,
                        headers={
                            "Authorization": f"Bearer {api_key}",
                            "Accept": "application/json",
                            "X-Model-Type": model_type,
                        },
                    )
                probe_type = (probe.headers.get("content-type") or "").lower()
                verified = (
                    200 <= probe.status_code < 300 and "text/html" not in probe_type
                )
            else:
                verified = 200 <= response.status_code < 300
    except (httpx.TimeoutException, asyncio.TimeoutError):
        raise ApiConfigVerificationTimeoutError(
            "API configuration verification timed out"
        ) from None
    except ApiConfigVerificationTimeoutError:
        raise
    except ApiConfigVerificationError:
        raise
    except Exception:
        raise ApiConfigVerificationError(
            "API configuration verification failed"
        ) from None

    if not verified:
        raise ApiConfigVerificationError(
            "API configuration verification failed"
        )


async def save_api_config(
    session: Session,
    user_id: uuid.UUID,
    api_key: str,
    model_type: str,
    base_url: str,
    verifier: Callable[[str, str, str], Awaitable[bool]] | None = None,
) -> ApiConfig:
    """Verify, encrypt, and persist one API configuration for a user."""
    _validate_required_field(api_key, "api_key")
    _validate_required_field(model_type, "model_type")
    _validate_required_field(base_url, "base_url")
    base_url = normalize_base_url(base_url)

    if session.scalar(select(ApiConfig).where(ApiConfig.user_id == user_id)) is not None:
        raise ApiConfigAlreadyExistsError("API configuration already exists")

    await _verify_api_config(api_key, model_type, base_url, verifier)

    config = ApiConfig(
        user_id=user_id,
        api_key_cipher=encrypt(api_key),
        model_type=model_type,
        base_url=base_url,
        is_verified=True,
    )
    try:
        session.add(config)
        session.commit()
        session.refresh(config)
    except IntegrityError as error:
        session.rollback()
        if _is_user_config_unique_violation(error):
            raise ApiConfigAlreadyExistsError(
                "API configuration already exists"
            ) from None
        raise
    except Exception:
        session.rollback()
        raise

    return config


async def update_api_config(
    session: Session,
    user_id: uuid.UUID,
    api_key: str,
    model_type: str,
    base_url: str,
    verifier: Callable[[str, str, str], Awaitable[bool]] | None = None,
) -> ApiConfig:
    """Verify a replacement and atomically update the existing configuration.

    An empty ``api_key`` keeps the previously stored ciphertext (so the user can
    fix Base URL / model without re-entering the secret).
    """
    _validate_required_field(model_type, "model_type")
    _validate_required_field(base_url, "base_url")
    base_url = normalize_base_url(base_url)

    config = session.scalar(select(ApiConfig).where(ApiConfig.user_id == user_id))
    if config is None:
        raise ApiConfigNotFoundError("API configuration does not exist")

    key_for_verify = (api_key or "").strip()
    reuse_stored_key = not key_for_verify
    if reuse_stored_key:
        try:
            from app.core.crypto import decrypt

            key_for_verify = decrypt(config.api_key_cipher)
        except Exception as error:
            raise ApiConfigFieldValidationError(
                "api key must not be empty"
            ) from error

    # Verify before changing the ORM object so a failed verification preserves it.
    await _verify_api_config(key_for_verify, model_type, base_url, verifier)
    if not reuse_stored_key:
        config.api_key_cipher = encrypt(key_for_verify)
    config.model_type = model_type
    config.base_url = base_url
    config.is_verified = True
    try:
        session.commit()
        session.refresh(config)
    except Exception:
        session.rollback()
        raise
    return config


def delete_api_config(session: Session, user_id: uuid.UUID) -> None:
    """Delete the user's configuration, committing or rolling back atomically."""
    config = session.scalar(select(ApiConfig).where(ApiConfig.user_id == user_id))
    if config is None:
        raise ApiConfigNotFoundError("API configuration does not exist")

    session.delete(config)
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise


def has_verified_api_config(session: Session, user_id: uuid.UUID) -> bool:
    """Return whether the user has a configuration explicitly marked verified."""
    return (
        session.scalar(
            select(ApiConfig.id).where(
                ApiConfig.user_id == user_id,
                ApiConfig.is_verified.is_(True),
            )
        )
        is not None
    )


def require_verified_api_config(session: Session, user_id: uuid.UUID) -> ApiConfig:
    """Return the verified configuration or raise a safe, credential-free error."""
    config = session.scalar(
        select(ApiConfig).where(
            ApiConfig.user_id == user_id,
            ApiConfig.is_verified.is_(True),
        )
    )
    if config is None:
        raise NoVerifiedApiConfigError()
    return config


def get_api_config(session: Session, user_id: uuid.UUID) -> ApiConfig | None:
    """Return the user's configuration, including an unverified record if present."""
    return session.scalar(select(ApiConfig).where(ApiConfig.user_id == user_id))


class ApiConfigModelsFetchError(ValueError):
    """Raised when the provider models endpoint cannot be listed."""

    code = "MODELS_FETCH_FAILED"

    def __init__(self, message: str = "无法获取可用模型列表") -> None:
        super().__init__(message)


def derive_chat_completions_url(base_url: str) -> str:
    """Ensure Base URL points at an OpenAI-compatible chat/completions endpoint."""
    cleaned = normalize_base_url(base_url).rstrip("/")
    if cleaned.endswith("/chat/completions"):
        return cleaned
    if cleaned.endswith("/completions") and not cleaned.endswith("/chat/completions"):
        # bare /completions → treat as already final
        return cleaned
    if cleaned.endswith("/models"):
        return cleaned[: -len("/models")] + "/chat/completions"
    return f"{cleaned}/chat/completions"


def apply_reasoning_strength(payload: dict, strength: str | None) -> dict:
    """Mutate a chat/completions payload according to UI reasoning strength.

    DeepSeek accepts ``thinking`` + ``reasoning_effort``; other OpenAI-compatible
    providers typically ignore unknown fields while still honoring temperature.
    """
    key = (strength or "standard").strip().lower()
    presets: dict[str, dict] = {
        "low": {"temperature": 0.7, "reasoning_effort": "low"},
        "standard": {"temperature": 0.4, "reasoning_effort": "medium"},
        "high": {
            "temperature": 0.3,
            "reasoning_effort": "high",
            "thinking": {"type": "enabled"},
        },
        "deep": {
            "temperature": 0.2,
            "reasoning_effort": "high",
            "thinking": {"type": "enabled"},
        },
    }
    chosen = presets.get(key, presets["standard"])
    payload.update(chosen)
    return payload


def derive_models_url(base_url: str) -> str:
    """Map a chat/completions-style Base URL to an OpenAI-compatible /models URL."""
    cleaned = validate_base_url(base_url).rstrip("/")
    if cleaned.endswith("/models"):
        return cleaned
    for suffix in ("/chat/completions", "/completions"):
        if cleaned.endswith(suffix):
            return cleaned[: -len(suffix)] + "/models"
    return f"{cleaned}/models"


def candidate_models_urls(base_url: str) -> list[str]:
    """Return distinct /models URLs to try (DeepSeek prefers host/models over /v1/models)."""
    primary = derive_models_url(base_url)
    candidates = [primary]
    if primary.endswith("/v1/models"):
        candidates.append(primary[: -len("/v1/models")] + "/models")
    elif primary.endswith("/models") and not primary.endswith("/v1/models"):
        root = primary[: -len("/models")]
        if not root.endswith("/v1"):
            candidates.append(f"{root}/v1/models")
    # Preserve order, drop duplicates
    seen: set[str] = set()
    ordered: list[str] = []
    for url in candidates:
        if url not in seen:
            seen.add(url)
            ordered.append(url)
    return ordered


async def list_remote_models(api_key: str, base_url: str) -> list[dict[str, str]]:
    """GET provider /models with Bearer key; return [{id, name}, ...].

    Never logs or returns the api_key. Compatible with OpenAI-style
    ``{"data":[{"id":"..."}]}`` payloads; unknown shapes raise a safe error.
    Tries a few URL variants so DeepSeek official Base URL works whether the
    user saved ``https://api.deepseek.com`` or ``.../v1``.
    """
    if not isinstance(api_key, str) or not api_key.strip():
        raise ApiConfigFieldValidationError("api key must not be empty")

    base_url = normalize_base_url(base_url)
    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "Accept": "application/json",
    }
    last_status: int | None = None
    saw_html = False

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            for models_url in candidate_models_urls(base_url):
                try:
                    response = await client.get(models_url, headers=headers)
                except (httpx.TimeoutException, asyncio.TimeoutError) as error:
                    raise ApiConfigVerificationTimeoutError(
                        "API configuration verification timed out"
                    ) from error
                last_status = response.status_code
                content_type = (response.headers.get("content-type") or "").lower()
                if "text/html" in content_type:
                    saw_html = True
                    continue
                if response.status_code == 404:
                    continue
                if response.status_code in (401, 403):
                    raise ApiConfigModelsFetchError(
                        "API Key 无效或无权访问模型列表，请检查密钥"
                    )
                if response.status_code >= 400:
                    raise ApiConfigModelsFetchError(
                        f"模型列表请求失败（HTTP {response.status_code}）"
                    )
                try:
                    payload = response.json()
                except Exception as error:
                    raise ApiConfigModelsFetchError(
                        "模型列表响应不是 JSON，请确认 Base URL 为 API 地址而非控制台网址"
                    ) from error
                models = _parse_models_payload(payload)
                if models:
                    return models
                raise ApiConfigModelsFetchError("未从该 API 解析到可用模型")
    except (ApiConfigVerificationTimeoutError, ApiConfigModelsFetchError, ApiConfigFieldValidationError):
        raise
    except Exception as error:
        raise ApiConfigModelsFetchError() from error

    if saw_html:
        raise ApiConfigModelsFetchError(
            "Base URL 指向了网页控制台而非 API。DeepSeek 请使用 https://api.deepseek.com"
        )
    if last_status == 404:
        raise ApiConfigModelsFetchError(
            "模型列表接口返回 404，请确认 Base URL（DeepSeek 官方一般为 https://api.deepseek.com）"
        )
    raise ApiConfigModelsFetchError()


def _parse_models_payload(payload: object) -> list[dict[str, str]]:
    rows: list = []
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            rows = data
        elif isinstance(payload.get("models"), list):
            rows = payload["models"]
    elif isinstance(payload, list):
        rows = payload

    models: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        if isinstance(row, str):
            model_id = row.strip()
        elif isinstance(row, dict):
            raw_id = row.get("id") or row.get("model") or row.get("name")
            model_id = str(raw_id).strip() if raw_id is not None else ""
        else:
            continue
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        models.append({"id": model_id, "name": model_id})
    return models
