import asyncio
import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.entities import ChatMessage, Conversation, MasteryEvidence, User
from app.routers.dependencies import get_current_user
from app.services import diagnosis_service as service
from app.services.ai_proxy import NoVerifiedApiConfigError, ResolvedCredential


@pytest.fixture
def db():
    engine = create_engine('sqlite:///:memory:', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        user = User(username='diagnosis', password_hash='unused')
        other = User(username='other', password_hash='unused')
        session.add_all([user, other])
        session.commit()
        yield session, user, other
    Base.metadata.drop_all(engine)
    engine.dispose()


def evidence(session, user, count=1):
    session.add_all([MasteryEvidence(user_id=user.id, evidence_type='quiz', result='wrong',
                                     grade_reason='边界条件遗漏') for _ in range(count)])
    session.commit()


def test_no_data_never_calls_ai_or_saves(db):
    session, user, _ = db
    with patch.object(service, '_generate', AsyncMock()) as generate:
        with pytest.raises(service.DiagnosisError, match='还没有刷题数据'):
            asyncio.run(service.generate_diagnosis(session, user.id))
        generate.assert_not_called()
    assert session.scalar(select(func.count()).select_from(Conversation)) == 0


@pytest.mark.parametrize('content', ['', '  ', '（模型未返回内容）'])
def test_empty_model_reply_is_not_saved(db, content):
    session, user, _ = db
    evidence(session, user)
    with patch.object(service, '_generate', AsyncMock(return_value=content)):
        with pytest.raises(service.DiagnosisError):
            asyncio.run(service.generate_diagnosis(session, user.id))
    assert service.latest_diagnosis(session, user.id) is None
    assert session.scalar(select(func.count()).select_from(Conversation)) == 0


def test_owned_snapshot_saved_and_read_after_rename_and_new_evidence(db):
    session, user, other = db
    evidence(session, user, 101)
    evidence(session, other, 3)
    with patch.object(service, '_generate', AsyncMock(return_value='建议复习边界条件')) as generate:
        report = asyncio.run(service.generate_diagnosis(session, user.id))
    snapshot = generate.call_args.args[2]
    assert snapshot['totalAnswered'] == 101
    assert snapshot['sampleCount'] == 100
    assert snapshot['distribution'] == {'correct': 0, 'partial': 0, 'wrong': 101}
    conversation = session.scalar(select(Conversation))
    conversation.title = '修改过的标题'
    session.commit()
    evidence(session, user)
    assert service.latest_diagnosis(session, user.id) == report
    assert service.latest_diagnosis(session, other.id) is None


def test_latest_skips_corrupt_metadata(db):
    session, user, _ = db
    evidence(session, user)
    with patch.object(service, '_generate', AsyncMock(return_value='学习建议')):
        report = asyncio.run(service.generate_diagnosis(session, user.id))
    conversation = session.scalar(select(Conversation))
    session.add(ChatMessage(conversation_id=conversation.id, role='assistant', content='损坏',
                            citations=json.dumps([{'kind': service.KIND, 'evidence': {}}]), position=1))
    session.commit()
    assert service.latest_diagnosis(session, user.id) == report


def test_actual_model_request_uses_owned_data_and_strips_thoughts(db):
    session, user, other = db
    evidence(session, user)
    evidence(session, other, 2)
    response = httpx.Response(200, json={'choices': [{'message': {
        'content': '<think>private</think>复习边界条件', 'reasoning_content': 'secret',
    }}]})
    client = AsyncMock()
    client.post.return_value = response
    credential = ResolvedCredential(api_key='secret-key', model_type='model', base_url='https://example.invalid/chat')
    with patch.object(service, 'resolve_credential', return_value=credential), patch.object(
        service.httpx, 'AsyncClient', return_value=client,
    ):
        client.__aenter__.return_value = client
        report = asyncio.run(service.generate_diagnosis(session, user.id))
    request = client.post.call_args.kwargs
    assert request['headers']['Authorization'] == 'Bearer secret-key'
    assert 'secret-key' not in json.dumps(request['json'])
    assert json.loads(request['json']['messages'][1]['content'])['totalAnswered'] == 1
    assert report['content'] == '复习边界条件'


@pytest.mark.parametrize('failure,expected', [
    (NoVerifiedApiConfigError(), 'NO_API_KEY'),
    (httpx.ReadTimeout('private upstream'), 'DIAGNOSIS_AI_FAILED'),
])
def test_routes_failure_is_safe_and_keeps_previous_report(db, failure, expected):
    session, user, other = db
    evidence(session, user)
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        with TestClient(app) as client, patch.object(service, '_generate', AsyncMock(return_value='旧报告')):
            saved = client.post('/api/statistics/diagnosis').json()['report']
            with patch.object(service, '_generate', AsyncMock(side_effect=failure)):
                failed = client.post('/api/statistics/diagnosis')
            assert failed.status_code in (400, 502)
            assert failed.json()['code'] == expected
            assert 'private upstream' not in failed.text
            assert client.get('/api/statistics/diagnosis/latest').json()['report'] == saved
            app.dependency_overrides[get_current_user] = lambda: other
            assert client.get('/api/statistics/diagnosis/latest').json()['report'] is None
            assert client.post('/api/statistics/diagnosis').json()['code'] == 'NO_PRACTICE_DATA'
    finally:
        app.dependency_overrides.clear()
