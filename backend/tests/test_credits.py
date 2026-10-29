import asyncio
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
import httpx
import pytest
from sqlalchemy import select, func, inspect, create_engine
from app.models.credits import CreditLot, CreditCall, CreditLedger
from app.services import credits_service as s
from tests.test_platform_billing import db
from tests.test_billing_migration import migration_runner


def test_free_idempotent_month_boundary_and_expiry(db):
    session, user = db
    now = datetime(2026,10,31,15,59,tzinfo=timezone.utc)
    s.prepare(session,user.id,now)
    s.prepare(session,user.id,now)
    assert session.scalar(select(func.count()).select_from(CreditLot)) == 1
    s.prepare(session,user.id,now+timedelta(minutes=2))
    assert session.scalar(select(func.count()).select_from(CreditLot)) == 2
    assert session.scalar(select(func.sum(CreditLot.remaining)).where(CreditLot.expires_at > now+timedelta(minutes=2))) == 500*s.MICRO


def test_reserve_release_and_charge(db):
    session,user=db
    s.reserve(session,user.id,'a',10000)
    assert s.finish(session,'a',(8,1))
    assert not s.finish(session,'a',(8,1))
    session.expire_all()
    lot=session.scalar(select(CreditLot))
    assert lot.remaining==500*s.MICRO-480 and lot.reserved==0
    s.reserve(session,user.id,'b',10000)
    s.finish(session,'b',None)
    session.expire_all()
    assert session.scalar(select(CreditLot)).reserved==0
    with pytest.raises(s.BillingError):s.reserve(session,user.id,'c',501*s.MICRO)


def test_real_shape_mock_usage_failure_release(db,monkeypatch):
    session,user=db
    monkeypatch.setenv('CREDITS_DEEPSEEK_ENABLED','true')
    monkeypatch.setenv('BILLING_PROVIDER_KEYS_JSON',json.dumps({'deepseek':'fixture-key'}))
    def handler(request):
        body=json.loads(request.content)
        assert body['model']=='deepseek-flash' and body['thinking']=={'type':'disabled'}
        return httpx.Response(200,json={'choices':[{'message':{'content':'OK'}}],'usage':{'prompt_tokens':8,'completion_tokens':1}})
    assert asyncio.run(s.complete(session,user.id,{'messages':[{'role':'user','content':'OK'}]},transport=httpx.MockTransport(handler)))=='OK'
    with pytest.raises(s.BillingError):
        asyncio.run(s.complete(session,user.id,{'messages':[]},transport=httpx.MockTransport(lambda r:httpx.Response(200,json={'choices':[]}))))
    assert session.scalar(select(func.sum(CreditLot.reserved)))==0
    assert session.scalar(select(func.sum(CreditLedger.amount)).where(CreditLedger.kind=='usage'))==-480


def test_credit_migration_roundtrip_preserves_currency(tmp_path):
    url,migrate=migration_runner(tmp_path,'credits.db')
    migrate('upgrade','b2f9e8d7c6a5')
    engine=create_engine(url)
    before=set(inspect(engine).get_table_names())
    migrate('upgrade','head')
    assert set(inspect(engine).get_table_names())==before|{'credit_lots','credit_calls','credit_ledger'}
    migrate('downgrade','b2f9e8d7c6a5')
    assert set(inspect(engine).get_table_names())==before
    migrate('upgrade','head')
    engine.dispose()


def test_test_grants_are_explicit_idempotent_and_not_payments(db):
    session,user=db
    s.prepare(session,user.id)
    s.grant_test_qihang(session,user.id)
    s.grant_test_qihang(session,user.id)
    assert session.scalar(select(func.count()).select_from(CreditLot)) == 3
    assert session.scalar(select(func.sum(CreditLot.remaining))) == 4500*s.MICRO
