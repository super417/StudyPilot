"""Safe HTTP model failure and retry, with temporary DB and mock upstream only."""
import asyncio
import json
from unittest.mock import patch
from uuid import uuid4
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select,func
from app.main import app
from app.core.database import get_db
from app.routers.dependencies import get_current_user
from app.models.entities import MasteryEvidence,PracticeQuestion
from app.models.credits import CreditCall,CreditLot
from app.services import practice_service,credits_service as credits
from app.services.ai_proxy import PlatformCredentialError,build_client_error
from app.services.billing_service import account,BillingError
from tests.test_platform_billing import db

@pytest.fixture
def client(db):
    session,user=db
    def database():yield session
    app.dependency_overrides[get_db]=database
    app.dependency_overrides[get_current_user]=lambda:user
    with TestClient(app) as value:yield value
    app.dependency_overrides.clear()


def test_real_grade_failure_keeps_previous_evidence_and_retry_succeeds(db,client,monkeypatch):
    session,user=db
    monkeypatch.setenv('CREDITS_DEEPSEEK_ENABLED','true')
    monkeypatch.setenv('BILLING_PROVIDER_KEYS_JSON',json.dumps({'deepseek':'fixture-key'}))
    row=account(session,user.id);row.mode='platform';row.model_id=credits.MODEL_ID;session.commit()
    credits.grant_test_qihang(session,user.id)
    question=practice_service.create_uploaded(session,user.id,question='矩阵的秩是什么',answer='线性无关向量个数',explanation='原解析',subject='线性代数')
    asyncio.run(practice_service.grade_answer(session,user.id,question.id,'第一次回答',grader=lambda *a:{'result':'wrong','reason':'旧判分','error_tag':'fixture'}))
    original=httpx.AsyncClient;attempts=[]
    def respond(request):
        attempts.append(request)
        if len(attempts)==1:return httpx.Response(503,text='private upstream detail fixture-key')
        return httpx.Response(200,json={'choices':[{'message':{'content':'{"result":"correct","reason":"新判分","error_tag":""}'}}],'usage':{'prompt_tokens':10,'completion_tokens':2}})
    def factory(*a,**k):k['transport']=httpx.MockTransport(respond);return original(*a,**k)
    endpoint=f'/api/practice/{question.id}/grade'
    with patch('httpx.AsyncClient',factory):
        failed=client.post(endpoint,json={'answerText':'重新作答'})
        assert failed.status_code==503
        assert failed.json()['code']=='PLATFORM_AI_FAILED'
        assert '重试' in failed.json()['message'] and 'fixture-key' not in failed.text
        session.expire_all()
        assert session.scalar(select(func.count()).select_from(MasteryEvidence))==1
        assert session.get(PracticeQuestion,question.id).question=='矩阵的秩是什么'
        assert session.get(PracticeQuestion,question.id).explanation=='原解析'
        old=session.scalar(select(MasteryEvidence));assert old.answer_text=='第一次回答' and old.grade_reason=='旧判分'
        assert session.scalar(select(func.sum(CreditLot.reserved)))==0
        assert session.scalar(select(CreditCall)).state=='released'
        retried=client.post(endpoint,json={'answerText':'重新作答'})
    assert retried.status_code==200 and retried.json()['result']=='correct'
    assert len(attempts)==2
    assert session.scalar(select(func.count()).select_from(MasteryEvidence))==2
    assert session.get(MasteryEvidence,old.id).grade_reason=='旧判分'


@pytest.mark.parametrize('route,service,payload',[
    ('/generate','generate_for_day',{'date':'2026-10-30'}),
    ('/reinforce-retest','generate_reinforce_retest',{'phaseId':str(uuid4())}),
    ('/phase-quiz','generate_phase_quiz',{'phaseId':str(uuid4())}),
    (f'/{uuid4()}/grade','grade_answer',{'answerText':'fixture'}),
    (f'/{uuid4()}/explain','explain_answer',{'answerText':'fixture'}),
])
def test_all_model_routes_return_safe_retryable_busy(db,client,monkeypatch,route,service,payload):
    async def busy(*a,**k):raise PlatformCredentialError('CREDITS_BUSY')
    monkeypatch.setattr(practice_service,service,busy)
    result=client.post('/api/practice'+route,json=payload)
    assert result.status_code==429
    assert result.json()['code']=='CREDITS_BUSY' and '重试' in result.json()['message']

@pytest.mark.parametrize('code',['CREDITS_BUSY','CREDITS_INSUFFICIENT','CALL_EXPIRED','FREE_CHAT_LIMIT'])
def test_platform_safe_codes_are_preserved(code):
    payload=build_client_error(PlatformCredentialError(code))
    assert payload['code']==code
    assert payload['message']!='凭证暂不可用，请稍后重试'
