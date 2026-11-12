"""Resume AI proxy: managed platform/BYOK vs independent DeepSeek key.

All outbound calls are mocked via httpx.MockTransport; no real network.
Reuses the ``db`` fixture from test_platform_billing (temporary sqlite).
"""

import asyncio
import json
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.main import app
from app.models.entities import ApiConfig
from app.routers.dependencies import get_current_user
from app.services import credits_service
from app.services.billing_service import account
from app.services.resume_ai_proxy_service import (
    ResumeAiProxyError,
    check_grammar,
    iter_polish_chunks,
    list_models_for_resume,
    test_connection as proxy_test_connection,
    _resolve,
)
from tests.test_platform_billing import db  # noqa: F401  (fixture reuse)


MANAGED = {
    "provider": "deepseek",
    "protocol": "chat-completions",
    "apiKey": "__STUDYPILOT_MANAGED__",
    "model": "deepseek-chat",
    "baseUrl": "https://api.deepseek.com",
}

REAL_KEY = {
    "provider": "deepseek",
    "protocol": "chat-completions",
    "apiKey": "sk-real-independent-key",
    "model": "deepseek-chat",
    "baseUrl": "https://api.deepseek.com",
}


def fund_credits(session, user, monkeypatch, model_id="credits:deepseek-flash", grant=True):
    monkeypatch.setenv("CREDITS_DEEPSEEK_ENABLED", "true")
    monkeypatch.setenv("BILLING_PROVIDER_KEYS_JSON", json.dumps({"deepseek": "fixture-key"}))
    row = account(session, user.id)
    row.mode, row.model_id = "platform", model_id
    session.commit()
    if grant:
        credits_service.grant_test_qihang(session, user.id)
    return row


def patch_httpx(respond):
    original = httpx.AsyncClient

    def client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(respond)
        return original(*args, **kwargs)

    return patch("httpx.AsyncClient", client)


def override_get_db(fixture_session):
    engine = fixture_session.get_bind()

    def override():
        session = Session(engine, expire_on_commit=False)
        try:
            yield session
        finally:
            session.close()

    return override


async def _collect(gen):
    return [piece async for piece in gen]


# ---------------------------------------------------------------------------
# managed sentinel → platform / personal-center credential
# ---------------------------------------------------------------------------


def test_managed_platform_resolves_metered_not_cred_unavailable(db, monkeypatch):
    session, user = db
    fund_credits(session, user, monkeypatch)

    credential = _resolve(session, user.id, MANAGED)

    assert credential.base_url == "platform://metered"
    assert credential.api_key == ""
    assert "__STUDYPILOT_MANAGED__" not in repr(credential)


def test_empty_api_key_is_managed_sentinel(db, monkeypatch):
    session, user = db
    fund_credits(session, user, monkeypatch)

    credential = _resolve(session, user.id, {**MANAGED, "apiKey": ""})

    assert credential.base_url == "platform://metered"
    assert credential.api_key == ""


def test_sentinel_is_not_treated_as_real_key(db, monkeypatch):
    session, user = db
    fund_credits(session, user, monkeypatch)

    credential = _resolve(session, user.id, MANAGED)

    # The sentinel must never become the outbound credential.
    assert credential.api_key != MANAGED["apiKey"]
    assert credential.model_type != MANAGED["model"]
    assert credential.base_url != "https://api.deepseek.com/chat/completions"


# ---------------------------------------------------------------------------
# platform mode routes through request_ai_completion (metered gateway)
# ---------------------------------------------------------------------------


def test_platform_ai_test_uses_metered_gateway(db, monkeypatch):
    session, user = db
    fund_credits(session, user, monkeypatch)
    captured = []

    def respond(request):
        captured.append(request)
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "OK"}}],
                "usage": {"prompt_tokens": 8, "completion_tokens": 1},
            },
        )

    with patch_httpx(respond):
        result = asyncio.run(proxy_test_connection(session, user.id, MANAGED))

    assert result == {"ok": True}
    assert len(captured) == 1
    assert captured[0].headers["Authorization"] == "Bearer fixture-key"


def test_platform_grammar_uses_metered_gateway(db, monkeypatch):
    session, user = db
    fund_credits(session, user, monkeypatch)
    reply = json.dumps({"errors": []}, ensure_ascii=False)

    def respond(request):
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": reply}}],
                "usage": {"prompt_tokens": 8, "completion_tokens": 1},
            },
        )

    with patch_httpx(respond):
        result = asyncio.run(check_grammar(session, user.id, "测试内容", MANAGED))

    content = result["choices"][0]["message"]["content"]
    assert json.loads(content)["errors"] == []


def test_platform_polish_yields_full_text_once(db, monkeypatch):
    session, user = db
    fund_credits(session, user, monkeypatch)

    def respond(request):
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "优化后的正文"}}],
                "usage": {"prompt_tokens": 8, "completion_tokens": 1},
            },
        )

    with patch_httpx(respond):
        gen = asyncio.run(iter_polish_chunks(session, user.id, "原文", "", MANAGED))
        chunks = asyncio.run(_collect(gen))

    assert chunks == ["优化后的正文"]


# ---------------------------------------------------------------------------
# independent DeepSeek key → direct outbound
# ---------------------------------------------------------------------------


def test_independent_deepseek_key_outbound(db):
    session, user = db
    captured = []

    def respond(request):
        captured.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    with patch_httpx(respond):
        result = asyncio.run(proxy_test_connection(session, user.id, REAL_KEY))

    assert result == {"ok": True}
    request = captured[0]
    assert request.headers["Authorization"] == "Bearer sk-real-independent-key"
    assert request.headers["X-Model-Type"] == "deepseek-chat"
    assert str(request.url) == "https://api.deepseek.com/chat/completions"
    assert json.loads(request.content)["model"] == "deepseek-chat"


def test_independent_key_not_persisted(db):
    session, user = db
    captured = []

    def respond(request):
        captured.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    with patch_httpx(respond):
        asyncio.run(proxy_test_connection(session, user.id, REAL_KEY))

    assert session.scalar(select(ApiConfig).where(ApiConfig.user_id == user.id)) is None


@pytest.mark.parametrize(
    "conn",
    [
        {**REAL_KEY, "provider": "openai"},
        {**REAL_KEY, "model": ""},
        {**REAL_KEY, "baseUrl": ""},
    ],
)
def test_independent_key_invalid_connection_rejected(db, conn):
    session, user = db
    with pytest.raises(ResumeAiProxyError) as error:
        asyncio.run(proxy_test_connection(session, user.id, conn))
    assert error.value.code == "INVALID_CONNECTION"


# ---------------------------------------------------------------------------
# models endpoint
# ---------------------------------------------------------------------------


def test_platform_models_do_not_call_out(db, monkeypatch):
    session, user = db
    fund_credits(session, user, monkeypatch)

    def respond(request):
        pytest.fail("platform models must not call out")

    with patch_httpx(respond):
        result = asyncio.run(
            list_models_for_resume(
                session,
                user.id,
                {"provider": "deepseek", "apiKey": "__STUDYPILOT_MANAGED__", "baseUrl": ""},
            )
        )

    assert result == {"models": ["deepseek-flash", "deepseek-v4-pro"]}


def test_independent_deepseek_models_list_remote(db):
    session, user = db

    def respond(request):
        return httpx.Response(
            200,
            json={"data": [{"id": "deepseek-chat"}, {"id": "deepseek-reasoner"}]},
        )

    with patch_httpx(respond):
        result = asyncio.run(
            list_models_for_resume(
                session,
                user.id,
                {"provider": "deepseek", "apiKey": "sk-real-key", "baseUrl": "https://api.deepseek.com"},
            )
        )

    assert result == {"models": ["deepseek-chat", "deepseek-reasoner"]}


# ---------------------------------------------------------------------------
# error code preservation
# ---------------------------------------------------------------------------


def test_credits_insufficient_code_preserved(db, monkeypatch):
    session, user = db
    # Enable credits but grant no spendable lots → reserve raises CREDITS_INSUFFICIENT.
    fund_credits(session, user, monkeypatch, grant=False)

    with pytest.raises(ResumeAiProxyError) as error:
        asyncio.run(proxy_test_connection(session, user.id, MANAGED))

    assert error.value.code == "CREDITS_INSUFFICIENT"


def test_platform_unavailable_code_preserved(db, monkeypatch):
    session, user = db
    fund_credits(session, user, monkeypatch, model_id="credits:unknown")

    with pytest.raises(ResumeAiProxyError) as error:
        asyncio.run(check_grammar(session, user.id, "内容", MANAGED))

    assert error.value.code == "PLATFORM_UNAVAILABLE"


# ---------------------------------------------------------------------------
# router body contract: connection / models top-level fields
# ---------------------------------------------------------------------------


def test_polish_platform_billing_error_returns_json(db, monkeypatch):
    session, user = db
    fund_credits(session, user, monkeypatch, grant=False)  # 无可用积分 → CREDITS_INSUFFICIENT

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = override_get_db(session)
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/polish",
                json={"content": "原文", "connection": MANAGED},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 502
    assert response.json()["code"] == "CREDITS_INSUFFICIENT"


def test_ai_test_reads_connection_from_body(db):
    session, user = db
    captured = []

    def respond(request):
        captured.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = override_get_db(session)
    try:
        with patch_httpx(respond):
            with TestClient(app) as client:
                response = client.post("/api/ai-test", json={"connection": REAL_KEY})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert captured[0].headers["Authorization"] == "Bearer sk-real-independent-key"
