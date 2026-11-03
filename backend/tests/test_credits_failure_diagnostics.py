import asyncio
import json
import logging

import httpx
import pytest
from sqlalchemy import func, select

from app.models.credits import CreditCall, CreditLot
from app.services import credits_service as service
from tests.test_platform_billing import db


@pytest.fixture
def configured(db, monkeypatch):
    session, user = db
    monkeypatch.setenv('CREDITS_DEEPSEEK_ENABLED', 'true')
    monkeypatch.setenv('BILLING_PROVIDER_KEYS_JSON', json.dumps({'deepseek': 'secret-api-key'}))
    return session, user


@pytest.mark.parametrize('paid', [False, True])
@pytest.mark.parametrize('failure,expected', [
    (401, '密钥或访问权限异常'), (403, '密钥或访问权限异常'),
    (402, '服务账户余额不足'), (429, '请求过于频繁'),
    (503, '服务暂时异常'), ('timeout', '响应超时'),
    ('connect', '检查服务器网络'), ('invalid_json', '响应异常'),
])
def test_failure_is_safe_and_releases_reservation(configured, caplog, paid, failure, expected):
    session, user = configured
    if paid:
        service.grant_test_qihang(session, user.id)
    secret = 'secret-answer-and-provider-body'

    def handler(request):
        if failure == 'timeout':
            raise httpx.ReadTimeout(secret, request=request)
        if failure == 'connect':
            raise httpx.ConnectError(secret, request=request)
        if failure == 'invalid_json':
            return httpx.Response(200, text=secret)
        return httpx.Response(failure, json={'error': {'message': secret}})

    with caplog.at_level(logging.ERROR, logger=service.__name__):
        with pytest.raises(service.BillingError) as raised:
            asyncio.run(service.complete(session, user.id,
                {'messages': [{'role': 'user', 'content': secret}]},
                request_id='diagnostic-test-call', transport=httpx.MockTransport(handler), allow_free_chat=True))
    assert raised.value.code == 'PLATFORM_AI_FAILED'
    assert expected in str(raised.value) and '预留积分已释放' in str(raised.value)
    assert secret not in caplog.text and 'secret-api-key' not in caplog.text
    assert secret not in str(raised.value)
    assert 'call_id=diagnostic-test-call' in caplog.text
    assert 'model=deepseek-flash' in caplog.text and 'elapsed_seconds=' in caplog.text
    if isinstance(failure, int):
        assert f'http_status={failure}' in caplog.text
    else:
        assert f'error_type={ {"timeout": "ReadTimeout", "connect": "ConnectError", "invalid_json": "JSONDecodeError"}[failure]}' in caplog.text
    session.expire_all()
    call = session.get(CreditCall, 'diagnostic-test-call')
    assert call.state == 'released' and call.charged == 0
    assert session.scalar(select(func.sum(CreditLot.reserved))) == 0
    assert service.free_chat_status(session, user.id)['remaining'] == 5
    if paid:
        assert session.scalar(select(func.sum(CreditLot.remaining)).where(CreditLot.kind != 'free_chat')) == 4000 * service.MICRO


def test_cancelled_call_releases_without_failure_log(configured, caplog):
    session, user = configured

    def handler(request):
        raise asyncio.CancelledError()

    with caplog.at_level(logging.ERROR, logger=service.__name__):
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(service.complete(session, user.id, {'messages': []}, request_id='cancelled',
                transport=httpx.MockTransport(handler), allow_free_chat=True))
    session.expire_all()
    assert session.get(CreditCall, 'cancelled').state == 'released'
    assert session.scalar(select(func.sum(CreditLot.reserved))) == 0
    assert not caplog.records


def test_success_keeps_usage_settlement(configured, caplog):
    session, user = configured
    service.grant_test_qihang(session, user.id)
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={
        'choices': [{'message': {'content': '正常回复'}}],
        'usage': {'prompt_tokens': 8, 'completion_tokens': 1},
    }))
    assert asyncio.run(service.complete(session, user.id, {'messages': []},
        request_id='success', transport=transport)) == '正常回复'
    session.expire_all()
    call = session.get(CreditCall, 'success')
    assert call.state == 'charged' and call.charged == 480
    assert session.scalar(select(func.sum(CreditLot.reserved))) == 0
    assert not caplog.records
