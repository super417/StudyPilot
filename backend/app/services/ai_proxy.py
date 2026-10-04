"""In-memory credential resolution for outbound AI calls (needs 3.1-3.5, 14.7).

This module decrypts the stored API key **only in process memory** for the
duration of a single outbound AI call, and guarantees that no credential
(plaintext or ciphertext) ever reaches the frontend response body, headers,
or error messages. The AI key travels exclusively in the outbound request
header, never in the business payload sent to the external AI.

Task 16.1 scope: prepare the credential and construct the outbound request.
The actual httpx streaming call (SSE forwarding, first-chunk timeout,
disconnect handling) belongs to task 16.2 and is only marked here.
"""

from contextlib import asynccontextmanager
from dataclasses import dataclass
import asyncio
import inspect
import json
import uuid
from typing import (
    AsyncIterator,
    Awaitable,
    Callable,
)
from contextlib import AbstractAsyncContextManager

import httpx
from sqlalchemy.orm import Session

from app.core.crypto import CryptoError, decrypt
from app.services.api_config_service import (
    NoVerifiedApiConfigError,
    derive_chat_completions_url,
    require_verified_api_config,
)

# Re-exported so callers can map both "no key" and "decrypt failed" branches
# without importing api_config_service directly.
__all__ = [
    "CredentialUnavailableError",
    "NoVerifiedApiConfigError",
    "ResolvedCredential",
    "resolve_credential",
    "build_outbound_headers",
    "build_client_error",
    "format_sse",
    "stream_ai_sse",
    "guard_sse_stream",
    "internal_error_frame",
    "httpx_chunk_stream",
    "FIRST_CHUNK_TIMEOUT_SECONDS",
    "ChunkStream",
    "SSE_TOKEN_EVENT",
    "SSE_ERROR_EVENT",
    "SSE_DONE_EVENT",
]


class CredentialUnavailableError(RuntimeError):
    """Raised when a stored credential cannot be decrypted for use.

    The message is a safe, generic string and never contains the API key,
    ciphertext, or an underlying exception's details.
    """

    code = "CRED_UNAVAILABLE"

    def __init__(self, message: str = "凭证暂不可用，请稍后重试") -> None:
        super().__init__(message)


# Safe, generic client-facing messages keyed by error code. These never
# expose credential material.
_CLIENT_ERROR_MESSAGES = {
    NoVerifiedApiConfigError.code: "请先在设置中配置并验证 API",
    CredentialUnavailableError.code: "凭证暂不可用，请稍后重试",
}


@dataclass(frozen=True)
class ResolvedCredential:
    """An immutable, memory-only credential used for a single outbound call.

    Intentionally provides no dict/JSON serialization. ``__repr__`` is
    overridden so the plaintext ``api_key`` is never rendered in logs, error
    reports, or debuggers.
    """

    api_key: str
    model_type: str
    base_url: str

    def __repr__(self) -> str:  # pragma: no cover - trivial masking
        return (
            "ResolvedCredential("
            f"model_type={self.model_type!r}, "
            f"base_url={self.base_url!r}, "
            "api_key=***)"
        )


def resolve_credential(session: Session, user_id: uuid.UUID) -> ResolvedCredential:
    """Return the user's decrypted credential for an in-memory outbound call.

    - Raises ``NoVerifiedApiConfigError`` (NO_API_KEY) when the user has no
      verified configuration; the error propagates unchanged and no outbound
      call is attempted.
    - Raises ``CredentialUnavailableError`` (CRED_UNAVAILABLE) when the stored
      ciphertext cannot be decrypted; no outbound call is attempted and no
      ciphertext is recorded.

    The plaintext key exists only inside the returned local object.
    """
    config = require_verified_api_config(session, user_id)

    try:
        api_key = decrypt(config.api_key_cipher)
    except CryptoError:
        # Do not chain the original error: its context could carry ciphertext.
        raise CredentialUnavailableError() from None

    return ResolvedCredential(
        api_key=api_key,
        model_type=config.model_type,
        base_url=derive_chat_completions_url(config.base_url),
    )


def build_outbound_headers(credential: ResolvedCredential) -> dict[str, str]:
    """Build headers for the external AI call.

    The credential travels only here, in the outbound header, never in the
    business payload and never in a response returned to the frontend.
    """
    return {
        "Authorization": f"Bearer {credential.api_key}",
        "X-Model-Type": credential.model_type,
    }


def build_client_error(error: Exception) -> dict:
    """Map a resolution error to a safe, credential-free client response.

    Returns ``{"status": "error", "code": ..., "message": ...}`` where the
    message is a generic Chinese string and never includes the API key,
    ciphertext, or the raw exception text.
    """
    code = getattr(error, "code", None)
    message = _CLIENT_ERROR_MESSAGES.get(code)
    if message is None:
        # Unknown errors collapse to a generic message so nothing leaks.
        code = CredentialUnavailableError.code
        message = _CLIENT_ERROR_MESSAGES[CredentialUnavailableError.code]
    return {"status": "error", "code": code, "message": message}


# The outbound business payload carries no credential fields: the API key is
# supplied only via build_outbound_headers. The frontend also guarantees its
# outbound request body contains no key field (needs 3.1). Because the backend
# never injects a credential into the payload, no extra sanitization function
# is needed here.


# ---------------------------------------------------------------------------
# SSE streaming (needs 3.6, 3.8, 3.9, 3.10)
# ---------------------------------------------------------------------------

# A ChunkStream yields the external AI's incremental text deltas one at a time.
ChunkStream = AsyncIterator[str]

# The three permitted SSE event types for the assistant/planner streams.
SSE_TOKEN_EVENT = "token"
SSE_ERROR_EVENT = "error"
SSE_DONE_EVENT = "done"

# Requirement 3.8: abort the external call if the first chunk does not arrive
# within 30 seconds.
FIRST_CHUNK_TIMEOUT_SECONDS = 30

# Safe, generic message pushed to the client on a first-chunk timeout. It never
# carries any credential or internal detail.
_AI_TIMEOUT_CODE = "AI_TIMEOUT"
_AI_TIMEOUT_MESSAGE = "AI 响应超时，请稍后重试"
# Generic fallback for any unexpected upstream failure. Deliberately opaque so
# no internal exception text or credential can leak to the frontend.
_AI_STREAM_ERROR_CODE = "AI_STREAM_ERROR"
_AI_STREAM_ERROR_MESSAGE = "AI 响应异常，请稍后重试"

# Emitted by ``guard_sse_stream`` when a stream crashes for a reason the route
# did not anticipate. Kept distinct from the AI-specific codes above so an
# internal fault is not misread as a model problem in logs or in the client.
SSE_INTERNAL_ERROR_CODE = "INTERNAL_ERROR"
SSE_INTERNAL_ERROR_MESSAGE = "服务异常，请稍后重试"


def format_sse(event: str, data: dict) -> str:
    """Encode a single SSE frame as ``event: <e>\\ndata: <json>\\n\\n``.

    ``data`` is serialized with ``ensure_ascii=False`` so Chinese text stays
    readable on the wire. Only the three known event types are permitted; an
    unknown event name is a programming error, not client input.
    """
    if event not in (SSE_TOKEN_EVENT, SSE_ERROR_EVENT, SSE_DONE_EVENT):
        raise ValueError(f"unsupported SSE event: {event!r}")
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


def _token_frame(delta: str) -> str:
    return format_sse(SSE_TOKEN_EVENT, {"delta": delta})


def _done_frame(extra: dict | None = None) -> str:
    data = {"finish": "stop"}
    if extra:
        data.update(extra)
    return format_sse(SSE_DONE_EVENT, data)


def _error_frame(code: str, message: str) -> str:
    # Mirrors build_client_error's safe shape; carries no credential material.
    return format_sse(SSE_ERROR_EVENT, {"code": code, "message": message})


async def _check_disconnected(
    is_disconnected: Callable[[], Awaitable[bool]] | Callable[[], bool] | None,
) -> bool:
    """Evaluate the optional disconnect probe, awaiting it when it is async."""
    if is_disconnected is None:
        return False
    result = is_disconnected()
    if inspect.isawaitable(result):
        result = await result
    return bool(result)


async def stream_ai_sse(
    stream_factory: Callable[[], AbstractAsyncContextManager[ChunkStream]],
    is_disconnected: Callable[[], Awaitable[bool]] | Callable[[], bool] | None = None,
    *,
    timeout: float = FIRST_CHUNK_TIMEOUT_SECONDS,
    done_extra: dict | None = None,
) -> AsyncIterator[str]:
    """Forward an external AI chunk stream as SSE frames.

    - ``stream_factory`` returns an async context manager whose entered value
      is an async iterator of text deltas. Decoupling from httpx lets tests
      inject a controlled stream with no real network.
    - The first chunk is awaited under ``asyncio.wait_for(..., timeout)``; on
      timeout an ``error`` frame (code ``AI_TIMEOUT``) is emitted, the upstream
      stream is closed, and the generator ends — closing the SSE (need 3.8).
    - Before each chunk (including the first) the optional ``is_disconnected``
      probe is checked; when truthy, iteration stops, the upstream stream is
      released, and nothing further is yielded — not even ``done`` (need 3.9).
    - On normal exhaustion a ``done`` frame is emitted.
    - The ``async with`` guarantees the upstream stream is always closed on
      every path (success, timeout, disconnect, error), avoiding leaks.

    No delta content or credential is ever logged; error frames use only the
    safe generic messages above.
    """
    async with stream_factory() as chunk_stream:
        iterator = chunk_stream.__aiter__()

        # Requirement 3.9: never even open the stream to a client already gone.
        if await _check_disconnected(is_disconnected):
            return

        # First chunk under the 30s timeout (requirement 3.8).
        try:
            first = await asyncio.wait_for(iterator.__anext__(), timeout)
        except asyncio.TimeoutError:
            yield _error_frame(_AI_TIMEOUT_CODE, _AI_TIMEOUT_MESSAGE)
            return
        except StopAsyncIteration:
            # Upstream closed with no data at all: still a clean finish.
            yield _done_frame(done_extra)
            return
        except Exception:
            # Opaque failure: never surface internal detail or credentials.
            yield _error_frame(_AI_STREAM_ERROR_CODE, _AI_STREAM_ERROR_MESSAGE)
            return

        yield _token_frame(first)

        # Remaining chunks: re-check disconnect before each, forward as tokens.
        while True:
            if await _check_disconnected(is_disconnected):
                return
            try:
                chunk = await iterator.__anext__()
            except StopAsyncIteration:
                break
            except Exception:
                yield _error_frame(_AI_STREAM_ERROR_CODE, _AI_STREAM_ERROR_MESSAGE)
                return
            yield _token_frame(chunk)

        yield _done_frame(done_extra)


def internal_error_frame() -> str:
    """The terminal frame ``guard_sse_stream`` sends when a stream crashes."""
    return _error_frame(SSE_INTERNAL_ERROR_CODE, SSE_INTERNAL_ERROR_MESSAGE)


async def guard_sse_stream(
    frames: AsyncIterator[str], error_frame: str
) -> AsyncIterator[str]:
    """Forward SSE frames, converting any crash into one terminal error frame.

    A generator that raises *before* its first ``yield`` cannot be recovered by
    Starlette: the response has already started, so all that is left is an
    abrupt close — HTTP 200 with an empty body. A client cannot tell that apart
    from a slow answer, so a crash there presents as a hang rather than a
    failure. Wrapping the whole generator guarantees the client always receives
    a frame it can render.

    ``GeneratorExit`` and ``CancelledError`` are deliberately left uncaught: a
    client that has already gone cannot receive a frame, and catching them would
    turn a normal disconnect into an error.
    """
    try:
        async for frame in frames:
            yield frame
    except Exception:
        yield error_frame


@asynccontextmanager
async def httpx_chunk_stream(
    credential: ResolvedCredential, payload: dict
) -> AsyncIterator[ChunkStream]:
    """Default httpx-backed chunk stream for the real external AI call.

    Opens a streaming POST to the credential's ``base_url`` with the outbound
    headers (the API key travels only here, never in the payload), and yields
    an async iterator of text deltas. Not exercised against the network in
    task 16.2's tests.
    """

    async def _iter(response: httpx.Response) -> ChunkStream:
        # TODO: real providers frame deltas differently (e.g. OpenAI emits
        # ``data: {json}`` SSE lines terminated by ``data: [DONE]``). When a
        # concrete provider is wired up, parse that framing here. For now this
        # is a generic pass-through skeleton that forwards each non-empty line.
        async for line in response.aiter_lines():
            if line:
                yield line

    async with httpx.AsyncClient() as client:
        async with client.stream(
            "POST",
            credential.base_url,
            headers=build_outbound_headers(credential),
            json=payload,
        ) as response:
            yield _iter(response)
