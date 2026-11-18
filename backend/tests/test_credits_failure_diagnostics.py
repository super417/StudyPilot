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


@pytest.fixture
def log_records():
    """Capture this module's logger directly, independent of global caplog state."""
    records = []
    handler = logging.Handler()
    handler.emit = records.append
    previous_level = service.logger.level
    previous_disabled = service.logger.disabled
    previous_disable = logging.root.manager.disable
    service.logger.addHandler(handler)
    service.logger.setLevel(logging.DEBUG)
    service.logger.disabled = False
    logging.disable(logging.NOTSET)
    try:
        yield records
    finally:
        logging.disable(previous_disable)
        service.logger.setLevel(previous_level)
        service.logger.disabled = previous_disabled
        service.logger.removeHandler(handler)


@pytest.mark.parametrize('paid', [False, True])
@pytest.mark.parametrize('failure,expected', [
    (401, '密钥或访问权限异常'), (403, '密钥或访问权限异常'),
    (402, '服务账户余额不足'), (429, '请求过于频繁'),
    (503, '服务暂时异常'), ('timeout', '响应超时'),
    ('connect', '检查服务器网络'), ('invalid_json', '响应异常'),
])
def test_failure_is_safe_and_releases_reservation(configured, log_records, paid, failure, expected):
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

    with pytest.raises(service.BillingError) as raised:
        asyncio.run(service.complete(session, user.id,
            {'messages': [{'role': 'user', 'content': secret}]},
            request_id='diagnostic-test-call', transport=httpx.MockTransport(handler), allow_free_chat=True))
    log_text = '\n'.join(record.getMessage() for record in log_records)
    assert raised.value.code == 'PLATFORM_AI_FAILED'
    assert expected in str(raised.value) and '预留积分已释放' in str(raised.value)
    assert secret not in log_text and 'secret-api-key' not in log_text
    assert secret not in str(raised.value)
    assert 'call_id=diagnostic-test-call' in log_text
    assert 'model=deepseek-flash' in log_text and 'elapsed_seconds=' in log_text
    if isinstance(failure, int):
        assert f'http_status={failure}' in log_text
    else:
        assert f'error_type={ {"timeout": "ReadTimeout", "connect": "ConnectError", "invalid_json": "JSONDecodeError"}[failure]}' in log_text
    session.expire_all()
    call = session.get(CreditCall, 'diagnostic-test-call')
    assert call.state == 'released' and call.charged == 0
    assert session.scalar(select(func.sum(CreditLot.reserved))) == 0
    assert service.free_chat_status(session, user.id)['remaining'] == 5
    if paid:
        assert session.scalar(select(func.sum(CreditLot.remaining)).where(CreditLot.kind != 'free_chat')) == 4000 * service.MICRO


def test_cancelled_call_releases_without_failure_log(configured, log_records):
    session, user = configured

    def handler(request):
        raise asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(service.complete(session, user.id, {'messages': []}, request_id='cancelled',
            transport=httpx.MockTransport(handler), allow_free_chat=True))
    session.expire_all()
    assert session.get(CreditCall, 'cancelled').state == 'released'
    assert session.scalar(select(func.sum(CreditLot.reserved))) == 0
    assert not log_records


def test_success_keeps_usage_settlement(configured, log_records):
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
    assert not log_records
