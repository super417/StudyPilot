"""Temporary databases and generated keys only; no merchant/model network is used."""
import asyncio
import base64
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.main import app
from app.models import Base
from app.models.billing import BillingAccount, BillingCall, BillingLedger, PaymentOrder
from app.models.entities import User
from app.routers.dependencies import get_current_user
from app.services import billing_service as service, payment_gateway as gateway, platform_ai_service
from app.services import adjustment_service, assistant_service, diagnosis_service, planner_service, practice_service
from app.services.ai_proxy import CredentialUnavailableError, resolve_credential
from app.services.billing_config import BillingSettings, platform_models


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("BILLING_MODELS_JSON", "[]")
    monkeypatch.setenv("BILLING_PROVIDER_KEYS_JSON", "{}")
    monkeypatch.setenv("BILLING_PAYMENTS_ENABLED", "false")
    engine = create_engine(f"sqlite:///{tmp_path / 'billing.sqlite'}", connect_args={"check_same_thread": False, "timeout": 20})
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        user = User(id=uuid.uuid4(), username="billing-user", password_hash="test-hash")
        session.add(user)
        session.commit()
        yield session, user
    engine.dispose()


@pytest.fixture
def models(monkeypatch):
    # Deliberately synthetic rates and credentials. Never commercial defaults.
    monkeypatch.setenv("BILLING_PROVIDER_KEYS_JSON", json.dumps({"test-provider": "test-not-real-key"}))
    monkeypatch.setenv("BILLING_MODELS_JSON", json.dumps([{"id": "test-model", "provider": "test-provider", "displayName": "Fixture model", "model": "fixture", "baseUrl": "https://provider.invalid/v1/chat/completions", "inputPricePerMillionYuan": "0.25", "outputPricePerMillionYuan": "1.25", "maxInputTokens": 1000, "maxOutputTokens": 100}]))
    return platform_models()["test-model"]


@pytest.fixture
def payment_settings():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    public = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    return BillingSettings(_env_file=None, payments_enabled=True, notify_base_url="https://merchant.invalid", alipay_app_id="fixture-app", alipay_seller_id="fixture-seller", alipay_private_key_pem=private, alipay_public_key_pem=public, wechat_app_id="fixture-wxapp", wechat_mchid="fixture-mch", wechat_serial="merchant-serial", wechat_private_key_pem=private, wechat_public_key_pem=public, wechat_public_serial="wechat-serial", wechat_api_v3_key="0" * 32)


def funded(session, user, amount=1000000):
    row = service.account(session, user.id)
    row.mode, row.model_id, row.balance_micros = "platform", "test-model", amount
    session.commit()
    return row


def payment_order(session, user, channel="alipay"):
    service.account(session, user.id)
    row = PaymentOrder(id=uuid.uuid4().hex, user_id=user.id, idempotency_key=uuid.uuid4().hex, channel=channel, amount_fen=100)
    session.add(row)
    session.commit()
    return row


def alipay_data(order):
    return {"out_trade_no": order.id, "app_id": "fixture-app", "seller_id": "fixture-seller", "trade_status": "TRADE_SUCCESS", "total_amount": "1.00", "trade_no": "fixture-transaction"}


def test_exact_price_and_round_only_total():
    assert service.cost_micros(1, 1, Decimal("0.25"), Decimal("0.25")) == 1
    assert service.cost_micros(10, 2, Decimal("0.25"), Decimal("1.25")) == 5
    assert service.cost_micros(0, 0, Decimal("0.25"), Decimal("1.25")) == 0
    for invalid in [None, -1, True, 2.5, "4"]:
        with pytest.raises(service.BillingError):
            service.cost_micros(invalid, 0, Decimal("1"), Decimal("1"))


def test_catalog_empty_without_credentials_or_prices(db):
    assert platform_models() == {}
    assert gateway.channel_available("alipay") is False


@pytest.mark.parametrize("rows,keys", [("{}", "{}"), ("[null]", "{}"), ("[]", "[]"), ('[{"id":4}]', '{}'), ('[{"id":"x","provider":"p","displayName":"x","model":false,"baseUrl":"https://x.invalid"}]', '{}')])
def test_malformed_catalog_fails_closed(rows, keys):
    assert platform_models(BillingSettings(_env_file=None, models_json=rows, provider_keys_json=keys)) == {}


def test_missing_payment_config_never_creates_order(db, models):
    session, user = db
    with pytest.raises(service.BillingError) as error:
        asyncio.run(service.create_order(session, user.id, 100, "alipay", "test-key-1"))
    assert error.value.status == 503
    assert session.scalar(select(func.count()).select_from(PaymentOrder)) == 0


def test_order_isolation_and_api_catalog_do_not_expose_credentials(db, models):
    session, user = db
    row = payment_order(session, user)
    with pytest.raises(service.BillingError) as error:
        service.owned_order(session, uuid.uuid4(), row.id)
    assert error.value.status == 404
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: session
    try:
        with TestClient(app) as client:
            catalog = client.get("/api/billing/catalog")
            assert catalog.status_code == 200
            assert "test-not-real-key" not in catalog.text
            assert "baseUrl" not in catalog.text
            assert catalog.json()["models"][0]["reservationMicros"] == 375
            assert client.get("/api/billing/account").json()["balanceMicros"] == 0
            assert client.post("/api/billing/orders", json={"amountFen": True, "channel": "alipay", "idempotencyKey": "fixture-key"}).status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_alipay_signature_rejects_changed_amount(payment_settings):
    params = {"app_id": "fixture-app", "total_amount": "1.00", "sign_type": "RSA2"}
    message = "&".join(f"{k}={v}" for k, v in sorted(params.items()) if k != "sign_type")
    params["sign"] = gateway.sign(message.encode(), payment_settings.alipay_private_key_pem)
    assert gateway.verify_alipay_notify(params, payment_settings)["total_amount"] == "1.00"
    params["total_amount"] = "100.00"
    with pytest.raises(gateway.PaymentError):
        gateway.verify_alipay_notify(params, payment_settings)


def test_payment_identity_amount_and_currency_are_required(db, payment_settings):
    session, user = db
    row = payment_order(session, user)
    valid = alipay_data(row)
    for changes in [{"app_id": "wrong"}, {"seller_id": "wrong"}, {"total_amount": "2.00"}, {"total_amount": "1.001"}, {"trade_status": "WAIT_BUYER_PAY"}, {"trans_currency": "USD"}]:
        with pytest.raises(service.BillingError):
            service.accept_payment(session, "alipay", {**valid, **changes}, payment_settings)
    assert service.account(session, user.id).balance_micros == 0


def test_verified_repeated_payment_credits_only_once(db, payment_settings):
    session, user = db
    row = payment_order(session, user)
    for _ in range(3):
        service.accept_payment(session, "alipay", alipay_data(row), payment_settings)
    assert service.account(session, user.id).balance_micros == 1000000
    assert session.scalar(select(func.count()).select_from(BillingLedger)) == 1


def test_concurrent_callback_credits_once(db, payment_settings):
    session, user = db
    row = payment_order(session, user)
    order_data, engine = alipay_data(row), session.get_bind()
    def callback(_):
        with Session(engine) as other:
            service.accept_payment(other, "alipay", order_data, payment_settings)
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(callback, [1, 2]))
    session.expire_all()
    assert service.account(session, user.id).balance_micros == 1000000
    assert session.scalar(select(func.count()).select_from(BillingLedger)) == 1


def wechat_headers(body, settings, timestamp=None):
    stamp = str(timestamp or int(time.time()))
    nonce = "fixture-nonce"
    signature = gateway.sign(stamp.encode() + b"\n" + nonce.encode() + b"\n" + body + b"\n", settings.wechat_private_key_pem)
    return {"Wechatpay-Timestamp": stamp, "Wechatpay-Nonce": nonce, "Wechatpay-Serial": settings.wechat_public_serial, "Wechatpay-Signature": signature}


def test_wechat_real_rsa_aes_and_tamper_or_replay_rejection(payment_settings):
    payload = {"out_trade_no": "fixture", "trade_state": "SUCCESS"}
    cipher = AESGCM(payment_settings.wechat_api_v3_key.encode()).encrypt(b"123456789012", json.dumps(payload).encode(), b"transaction")
    body = json.dumps({"event_type": "TRANSACTION.SUCCESS", "resource": {"algorithm": "AEAD_AES_256_GCM", "nonce": "123456789012", "associated_data": "transaction", "ciphertext": base64.b64encode(cipher).decode()}}).encode()
    headers = wechat_headers(body, payment_settings)
    assert gateway.decrypt_wechat_notify(body, headers, payment_settings) == payload
    for bad_body, bad_headers in [(body + b" ", headers), (body, {**headers, "Wechatpay-Serial": "wrong"}), (body, wechat_headers(body, payment_settings, int(time.time()) - 600))]:
        with pytest.raises(gateway.PaymentError):
            gateway.decrypt_wechat_notify(bad_body, bad_headers, payment_settings)


def test_wechat_native_verifies_provider_response(db, payment_settings):
    session, user = db
    row = payment_order(session, user, "wechat")
    body = json.dumps({"code_url": "weixin://wxpay/bizpayurl?pr=fixture"}).encode()
    def respond(request):
        assert request.headers["Authorization"].startswith("WECHATPAY2-SHA256-RSA2048")
        assert json.loads(request.content)["amount"]["total"] == 100
        return httpx.Response(200, content=body, headers=wechat_headers(body, payment_settings))
    result = asyncio.run(gateway.create_payment(row, payment_settings, httpx.MockTransport(respond)))
    assert result[1].startswith("weixin://")
    def unverified(request):
        return httpx.Response(200, content=body)
    with pytest.raises(gateway.PaymentError):
        asyncio.run(gateway.create_payment(row, payment_settings, httpx.MockTransport(unverified)))


def test_budget_reservation_concurrency_never_overdraws(db, models):
    session, user = db
    funded(session, user, 400)
    def reserve(_):
        with Session(session.get_bind()) as other:
            try:
                service.reserve_call(other, user.id, models, uuid.uuid4().hex)
                return True
            except service.BillingError:
                return False
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(reserve, [1, 2])) == [False, True]
    session.expire_all()
    row = service.account(session, user.id)
    assert row.reserved_micros == 375 and row.balance_micros == 400


def test_settlement_idempotent_and_expiry_cas(db, models):
    session, user = db
    row = funded(session, user)
    call = service.reserve_call(session, user.id, models, uuid.uuid4().hex)
    service.finish_call(session, call.id, (5, 10, 2))
    service.finish_call(session, call.id, (5, 10, 2))
    service.finish_call(session, call.id, None)
    session.refresh(row)
    assert row.balance_micros == 999995 and row.reserved_micros == 0
    call2 = service.reserve_call(session, user.id, models, uuid.uuid4().hex)
    call2.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    session.commit()
    service.expire_calls(session, user.id)
    session.commit()
    service.finish_call(session, call2.id, (5, 10, 2))
    session.refresh(row)
    assert row.balance_micros == 999995 and row.reserved_micros == 0


def test_gateway_actual_usage_and_no_business_pending_commit(db, models):
    session, user = db
    funded(session, user)
    pending = User(id=uuid.uuid4(), username="pending-business-write", password_hash="test")
    session.add(pending)  # Not flushed; ledger may not flush or commit this.
    def respond(request):
        assert request.headers["Authorization"] == "Bearer test-not-real-key"
        assert json.loads(request.content)["stream"] is False
        assert json.loads(request.content)["max_tokens"] == 100
        return httpx.Response(200, json={"choices": [{"message": {"content": "fixture reply"}}], "usage": {"prompt_tokens": 10, "completion_tokens": 2}})
    text = asyncio.run(platform_ai_service.complete(session, user.id, {"messages": [{"role": "user", "content": "hi"}]}, transport=httpx.MockTransport(respond)))
    assert text == "fixture reply"
    with Session(session.get_bind()) as other:
        assert other.get(User, pending.id) is None
        assert service.account(other, user.id).balance_micros == 999995
    session.rollback()


@pytest.mark.parametrize("kind", ["missing_usage", "negative", "over_limit", "empty_content", "blank_content", "timeout"])
def test_gateway_failure_releases_without_invented_usage(db, models, kind):
    session, user = db
    funded(session, user)
    def respond(request):
        if kind == "timeout":
            raise httpx.ReadTimeout("do not expose", request=request)
        data = {"choices": [{"message": {"content": "reply"}}], "usage": {"prompt_tokens": 10, "completion_tokens": 2}}
        if kind == "missing_usage": data.pop("usage")
        if kind == "negative": data["usage"]["prompt_tokens"] = -1
        if kind == "over_limit": data["usage"]["completion_tokens"] = 101
        if kind == "empty_content": data["choices"][0]["message"]["content"] = None
        if kind == "blank_content": data["choices"][0]["message"]["content"] = "  "
        return httpx.Response(200, json=data)
    with pytest.raises(service.BillingError):
        asyncio.run(platform_ai_service.complete(session, user.id, {"messages": [{"role": "user", "content": "hi"}]}, transport=httpx.MockTransport(respond)))
    session.expire_all()
    row = service.account(session, user.id)
    assert row.balance_micros == 1000000 and row.reserved_micros == 0
    assert session.scalar(select(BillingCall.state)) == "released"


def test_unsupported_capability_cannot_export_platform_key(db, models):
    session, user = db
    funded(session, user)
    with pytest.raises(CredentialUnavailableError):
        resolve_credential(session, user.id)
    sentinel = resolve_credential(session, user.id, allow_platform=True)
    assert sentinel.api_key == ""
    assert "test-not-real-key" not in repr(sentinel)


def test_create_alipay_order_idempotent_but_never_credits(db, models, payment_settings):
    session, user = db
    row = asyncio.run(service.create_order(session, user.id, 100, "alipay", "fixture-key", payment_settings))
    assert row.state == "pending" and row.payment_url.startswith("https://openapi.alipay.com/")
    again = asyncio.run(service.create_order(session, user.id, 100, "alipay", "fixture-key", payment_settings))
    assert again.id == row.id
    assert service.account(session, user.id).balance_micros == 0
    with pytest.raises(service.BillingError):
        asyncio.run(service.create_order(session, user.id, 200, "alipay", "fixture-key", payment_settings))


def test_signed_alipay_query_without_identity_fields_reconciles(db, payment_settings):
    session, user = db
    row = payment_order(session, user)
    data = {"code": "10000", "out_trade_no": row.id, "trade_no": "query-fixture-transaction", "total_amount": "1.00", "trade_status": "TRADE_SUCCESS"}
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    signed = gateway.sign(raw.encode(), payment_settings.alipay_private_key_pem)
    response_body = '{"alipay_trade_query_response":' + raw + ',"sign":' + json.dumps(signed) + '}'
    def respond(request):
        assert request.url == "https://openapi.alipay.com/gateway.do"
        assert b"alipay.trade.query" in request.content
        return httpx.Response(200, text=response_body)
    result = asyncio.run(service.query_order(session, user.id, row.id, payment_settings, httpx.MockTransport(respond)))
    assert result.state == "paid"
    assert service.account(session, user.id).balance_micros == 1000000
    # Exact same dictionary is not sufficient as an unsigned notification.
    with pytest.raises(service.BillingError):
        service.accept_payment(session, "alipay", data, payment_settings)


@pytest.mark.parametrize("capability", ["assistant", "planning", "diagnosis", "practice_generate", "practice_grade"])
def test_supported_capabilities_use_metered_network_gateway(db, models, monkeypatch, capability):
    session, user = db
    rows = json.loads(__import__("os").environ["BILLING_MODELS_JSON"])
    rows[0]["maxInputTokens"] = 100000
    monkeypatch.setenv("BILLING_MODELS_JSON", json.dumps(rows))
    funded(session, user)
    if capability == "planning":
        reply = json.dumps({"phases": [{"name": "one", "start_date": "2026-10-29", "end_date": "2026-10-30", "daily_tasks": []}, {"name": "two", "start_date": "2026-10-31", "end_date": "2026-11-01", "daily_tasks": []}]})
    elif capability == "practice_grade":
        reply = '{"result":"partial","reason":"fixture","error_tag":"fixture"}'
    else:
        reply = "fixture model response"
    calls = []
    def respond(request):
        calls.append(json.loads(request.content))
        assert request.headers["Authorization"] == "Bearer test-not-real-key"
        return httpx.Response(200, json={"choices": [{"message": {"content": reply}}], "usage": {"prompt_tokens": 10, "completion_tokens": 2}})
    original_client = httpx.AsyncClient
    def client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(respond)
        return original_client(*args, **kwargs)
    async def invoke():
        if capability == "assistant":
            return [frame async for frame in assistant_service._stream_chat_reply(session, user.id, "Python学习", None)]
        if capability == "planning":
            return await planner_service._generate_structure_via_ai_proxy(session, user.id, {"goalName": "Python", "goalDate": "2027-01-01", "currentLevel": "beginner", "dailyMinutes": 30, "completionCriterion": "fixture"}, [], "", "", [])
        if capability == "diagnosis":
            return await diagnosis_service._generate(session, user.id, {"totalAnswered": 1})
        if capability == "practice_generate":
            return await practice_service._default_generator(session, user.id, ["fixture task"], "fixture context")
        return await practice_service._call_grade_model(session, user.id, system="fixture grader", user_content="fixture answer", parse=lambda data: data)
    with patch("httpx.AsyncClient", client):
        result = asyncio.run(invoke())
    assert result
    assert len(calls) == 1 and calls[0]["stream"] is False
    session.expire_all()
    assert service.account(session, user.id).balance_micros == 999995
    assert session.scalar(select(func.count()).select_from(BillingLedger).where(BillingLedger.kind == "ai_charge")) == 1


def test_byok_request_does_not_touch_platform_balance(db, models):
    session, user = db
    row = funded(session, user)
    row.mode = "byok"
    session.commit()
    from app.services.ai_proxy import ResolvedCredential, request_ai_completion
    credential = ResolvedCredential(api_key="fixture-own-key", model_type="fixture-own-model", base_url="https://own.invalid/chat/completions")
    original_client = httpx.AsyncClient
    def respond(request):
        assert request.headers["Authorization"] == "Bearer fixture-own-key"
        return httpx.Response(200, json={"choices": [{"message": {"content": "own reply"}}]})
    def client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(respond)
        return original_client(*args, **kwargs)
    with patch("httpx.AsyncClient", client):
        response = asyncio.run(request_ai_completion(session, user.id, credential, {"model": "fixture-own-model"}))
    assert response.status_code == 200
    assert service.account(session, user.id).balance_micros == 1000000
    assert session.scalar(select(func.count()).select_from(BillingCall)) == 0


def test_expiry_and_settlement_compete_without_double_release(db, models):
    session, user = db
    funded(session, user)
    call = service.reserve_call(session, user.id, models, uuid.uuid4().hex)
    call.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    session.commit()
    engine = session.get_bind()
    def settle():
        with Session(engine) as other:
            service.finish_call(other, call.id, (5, 10, 2))
    def expire():
        with Session(engine) as other:
            service.expire_calls(other, user.id)
            other.commit()
    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = pool.submit(settle), pool.submit(expire)
        first.result()
        second.result()
    session.expire_all()
    row = service.account(session, user.id)
    assert row.reserved_micros == 0 and row.balance_micros in {1000000, 999995}
    assert session.scalar(select(func.count()).select_from(BillingLedger)) == 1


def test_signed_notify_routes_credit_once_and_reject_tampering(db, payment_settings):
    session, user = db
    alipay = payment_order(session, user)
    wechat = payment_order(session, user, "wechat")
    ali_data = {**alipay_data(alipay), "sign_type": "RSA2"}
    ali_message = "&".join(f"{key}={value}" for key, value in sorted(ali_data.items()) if key != "sign_type")
    ali_data["sign"] = gateway.sign(ali_message.encode(), payment_settings.alipay_private_key_pem)
    wx_data = {"out_trade_no": wechat.id, "appid": payment_settings.wechat_app_id, "mchid": payment_settings.wechat_mchid, "trade_state": "SUCCESS", "transaction_id": "wechat-fixture-transaction", "amount": {"total": 100, "currency": "CNY"}}
    cipher = AESGCM(payment_settings.wechat_api_v3_key.encode()).encrypt(b"123456789012", json.dumps(wx_data).encode(), b"transaction")
    body = json.dumps({"event_type": "TRANSACTION.SUCCESS", "resource": {"algorithm": "AEAD_AES_256_GCM", "nonce": "123456789012", "associated_data": "transaction", "ciphertext": base64.b64encode(cipher).decode()}}).encode()
    headers = wechat_headers(body, payment_settings)
    app.dependency_overrides[get_db] = lambda: session
    try:
        with patch("app.routers.billing.BillingSettings", return_value=payment_settings), TestClient(app) as client:
            assert client.post("/api/billing/notify/alipay", data={**ali_data, "total_amount": "9.99"}).status_code == 400
            for _ in range(2):
                assert client.post("/api/billing/notify/alipay", data=ali_data).text == "success"
                assert client.post("/api/billing/notify/wechat", content=body, headers=headers).status_code == 204
            assert client.post("/api/billing/notify/wechat", content=body + b" ", headers=headers).status_code == 400
        session.expire_all()
        assert service.account(session, user.id).balance_micros == 2000000
        assert session.scalar(select(func.count()).select_from(BillingLedger)) == 2
    finally:
        app.dependency_overrides.clear()


def test_platform_adjustment_still_checks_plan_ownership_before_generation(db, models):
    session, user = db
    funded(session, user)
    plan_id = uuid.uuid4()
    # No BYOK exists. Platform access can reach the existing ownership check,
    # but must not skip it or create a preview/charge before it succeeds.
    with patch.object(planner_service, "_owned_plan", side_effect=ValueError("owned-plan-check")) as owned:
        with pytest.raises(ValueError, match="owned-plan-check"):
            asyncio.run(adjustment_service.create_preview(session, user.id, plan_id, "fixture", None, None))
    owned.assert_called_once_with(session, user.id, plan_id)
    assert session.scalar(select(func.count()).select_from(BillingCall)) == 0
