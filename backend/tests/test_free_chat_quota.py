import asyncio
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import httpx
import pytest
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.models.credits import CreditLot, CreditCall, CreditLedger
from app.models.entities import User
from app.services import credits_service as s
from app.services.billing_service import account
from app.services import assistant_service, platform_ai_service
from app.routers.credits import read_account, catalog
from tests.test_platform_billing import db

@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setenv('CREDITS_DEEPSEEK_ENABLED','true')
    monkeypatch.setenv('BILLING_PROVIDER_KEYS_JSON',json.dumps({'deepseek':'fixture-key'}))

def response(content='OK', usage=None):
    return httpx.Response(200,json={'choices':[{'message':{'content':content}}], 'usage':usage or {'prompt_tokens':8,'completion_tokens':1}})

def invoke(session,user,transport,**kwargs):
    return asyncio.run(s.complete(session,user.id,{'messages':[{'role':'user','content':'题目'}]},transport=transport,**kwargs))

def test_five_successes_sixth_blocked_and_read_does_not_reset(db,enabled):
    session,user=db; calls=[]
    transport=httpx.MockTransport(lambda r:(calls.append(r),response())[1])
    for expected in range(4,-1,-1):
        assert invoke(session,user,transport,allow_free_chat=True)=='OK'
        assert read_account(user,session)['freeChat']['remaining']==expected
    with pytest.raises(s.BillingError,match='5 次'):invoke(session,user,transport,allow_free_chat=True)
    assert len(calls)==5
    result=read_account(user,session)
    assert result['freeChat']['remaining']==0 and result['availableMicroPoints']==0 and result['lots']==[]
    assert catalog(user)['plans'][0]['basePoints']==0
    assert session.scalar(select(func.count()).select_from(CreditLedger))==0

@pytest.mark.parametrize('reply',[httpx.Response(503),response(''),response(usage={'prompt_tokens':-1,'completion_tokens':1}),httpx.Response(200,json={'choices':[]})])
def test_failed_invalid_replies_release(db,enabled,reply):
    session,user=db
    with pytest.raises(s.BillingError):invoke(session,user,httpx.MockTransport(lambda r:reply),allow_free_chat=True)
    result=read_account(user,session)['freeChat']
    assert (result['remaining'],result['reserved'])==(5,0)

def test_timeout_cancel_and_retry(db,enabled):
    session,user=db
    def fail(request):raise httpx.ReadTimeout('synthetic')
    with pytest.raises(s.BillingError):invoke(session,user,httpx.MockTransport(fail),allow_free_chat=True)
    def cancel(request):raise asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):invoke(session,user,httpx.MockTransport(cancel),allow_free_chat=True)
    assert read_account(user,session)['freeChat']['remaining']==5
    assert invoke(session,user,httpx.MockTransport(lambda r:response()),allow_free_chat=True)=='OK'
    assert read_account(user,session)['freeChat']['remaining']==4

def test_concurrent_five_only_stale_release(db):
    session,user=db;engine=session.get_bind();s.prepare(session,user.id)
    def reserve(i):
        with Session(engine) as local:
            try:s.reserve_free_chat(local,user.id,f'parallel-{i}');return True
            except s.BillingError:return False
    with ThreadPoolExecutor(max_workers=8) as pool:results=list(pool.map(reserve,range(12)))
    assert sum(results)==5
    session.expire_all()
    assert s.free_chat_status(session,user.id)['remaining']==0
    assert s.free_chat_status(session,user.id)['reserved']==5
    s.prepare(session,user.id,datetime.now(timezone.utc)+timedelta(minutes=11));session.expire_all()
    assert s.free_chat_status(session,user.id)['remaining']==5
    assert s.free_chat_status(session,user.id)['reserved']==0

def test_beijing_boundary_and_user_isolation(db):
    session,user=db;now=datetime(2026,10,31,15,59,tzinfo=timezone.utc)
    s.reserve_free_chat(session,user.id,'old-period',now);s.finish(session,'old-period',(8,1),now=now);session.expire_all()
    assert s.free_chat_status(session,user.id,now)['remaining']==4
    after=now+timedelta(minutes=2);s.prepare(session,user.id,after)
    assert s.free_chat_status(session,user.id,after)['remaining']==5
    other=User(id=uuid.uuid4(),username='other',password_hash='fixture');session.add(other);session.commit();s.prepare(session,other.id,now)
    assert s.free_chat_status(session,other.id,now)['remaining']==5

def test_legacy_free_cannot_bypass_or_fund_other_capabilities(db,enabled):
    session,user=db;_,end=s.month_bounds(datetime.now(timezone.utc))
    session.add(CreditLot(id=f'free:{user.id}:legacy',user_id=user.id,kind='base',granted=500*s.MICRO,remaining=500*s.MICRO,reserved=0,expires_at=end));session.commit()
    calls=[];transport=httpx.MockTransport(lambda r:(calls.append(r),response())[1])
    with pytest.raises(s.BillingError):invoke(session,user,transport)
    assert not calls and read_account(user,session)['availableMicroPoints']==0
    assert invoke(session,user,transport,allow_free_chat=True)=='OK'
    session.expire_all();assert session.get(CreditLot,f'free:{user.id}:legacy').remaining==500*s.MICRO

def test_test_plan_charges_points_without_rounds(db,enabled):
    session,user=db;s.grant_test_qihang(session,user.id)
    for _ in range(6):assert invoke(session,user,httpx.MockTransport(lambda r:response()),allow_free_chat=True)=='OK'
    result=read_account(user,session)
    assert result['freeChat']['remaining']==5 and not result['freeChat']['eligible']
    assert result['availableMicroPoints']==4000*s.MICRO-6*480

def test_assistant_gateway_only_and_local_refusal(db,enabled,monkeypatch):
    session,user=db;preference=account(session,user.id);preference.mode='platform';preference.model_id=s.MODEL_ID;session.commit()
    original=platform_ai_service.complete;flags=[]
    async def mock_complete(local,user_id,payload,**kwargs):
        flags.append(kwargs.get('allow_free_chat'))
        return await original(local,user_id,payload,transport=httpx.MockTransport(lambda r:response()),**kwargs)
    monkeypatch.setattr(platform_ai_service,'complete',mock_complete)
    async def collect():return [frame async for frame in assistant_service._stream_chat_reply(session,user.id,'解释二分查找',None)]
    frames=asyncio.run(collect());assert flags==[True] and any('done' in f for f in frames)
    assert read_account(user,session)['freeChat']['remaining']==4
    async def local():return [frame async for frame in assistant_service.stream_assistant_reply(session,user.id,'推荐个炒股荐股软件',None)]
    asyncio.run(local())
    assert flags==[True] and read_account(user,session)['freeChat']['remaining']==4


def test_byok_chat_ignores_exhausted_free_rounds(db,monkeypatch):
    from contextlib import asynccontextmanager
    from app.services.ai_proxy import ResolvedCredential
    session,user=db
    s.prepare(session,user.id)
    period,_=s.month_bounds(datetime.now(timezone.utc))
    lot=session.get(CreditLot,f'free_chat:{user.id}:{period}');lot.remaining=0;session.commit()
    monkeypatch.setattr(assistant_service,'has_verified_api_config',lambda *_:True)
    monkeypatch.setattr(assistant_service,'resolve_credential',lambda *a,**k:ResolvedCredential(api_key='fixture',model_type='fixture',base_url='https://own.invalid/chat/completions'))
    @asynccontextmanager
    async def stream(credential,payload):
        async def chunks():yield 'own reply'
        yield chunks()
    async def collect():return [frame async for frame in assistant_service._stream_chat_reply(session,user.id,'解释二分查找',None,stream_factory=stream)]
    frames=asyncio.run(collect())
    assert any('own reply' in frame for frame in frames) and any('done' in frame for frame in frames)
    assert read_account(user,session)['freeChat']['remaining']==0
    assert session.scalar(select(func.count()).select_from(CreditCall))==0
