import asyncio
import json
from datetime import datetime, timezone

import httpx
import pytest
from sqlalchemy import select, func

from app.models.credits import CreditLot, CreditCall
from app.routers.credits import catalog, preferences, Preferences
from app.services import credits_service as s, platform_ai_service
from app.services.billing_service import account
from tests.test_platform_billing import db


@pytest.mark.parametrize('model_id, upstream', list((k, v[0]) for k, v in s.MODELS.items()))
def test_catalog_selection_call_and_settlement(db, monkeypatch, model_id, upstream):
    session, user = db
    monkeypatch.setenv('CREDITS_DEEPSEEK_ENABLED', 'true')
    monkeypatch.setenv('BILLING_PROVIDER_KEYS_JSON', json.dumps({'deepseek': 'fixture-key'}))
    models = catalog(user)['models']
    assert {m['id'] for m in models} == set(s.MODELS)
    assert all(m['inputPointsPerMillion'] == '40' and m['outputPointsPerMillion'] == '160' for m in models)
    preferences(Preferences(mode='platform', modelId=model_id), user, session)
    s.grant_test_qihang(session, user.id)

    def handler(request):
        assert json.loads(request.content)['model'] == upstream
        return httpx.Response(200, json={'choices': [{'message': {'content': 'OK'}}], 'usage': {'prompt_tokens': 8, 'completion_tokens': 1}})

    assert asyncio.run(platform_ai_service.complete(session, user.id, {'messages': [], 'model': 'untrusted'}, transport=httpx.MockTransport(handler))) == 'OK'
    session.expire_all()
    assert sum(l.remaining for l in s.spendable_lots(session, user.id, datetime.now(timezone.utc))) == 4000 * s.MICRO - 480
    assert session.scalar(select(func.sum(CreditLot.reserved))) == 0
    assert session.scalar(select(CreditCall.charged)) == 480


def test_unknown_model_rejected_before_call(db, monkeypatch):
    session, user = db
    monkeypatch.setenv('CREDITS_DEEPSEEK_ENABLED', 'true')
    monkeypatch.setenv('BILLING_PROVIDER_KEYS_JSON', json.dumps({'deepseek': 'fixture-key'}))
    row = account(session, user.id)
    row.mode, row.model_id = 'platform', 'credits:unknown'
    session.commit()
    with pytest.raises(s.BillingError, match='请选择'):
        asyncio.run(platform_ai_service.complete(session, user.id, {}, transport=httpx.MockTransport(lambda _: pytest.fail('must not call provider'))))
    assert session.scalar(select(func.count()).select_from(CreditCall)) == 0
