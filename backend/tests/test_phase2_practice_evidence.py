import asyncio
from uuid import uuid4
from datetime import datetime, timedelta
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select,func
from app.main import app
from app.core.database import get_db
from app.routers.dependencies import get_current_user
from app.models.entities import PracticeQuestion,MasteryEvidence,UserDocument,ReinforceTaskEvidence
from app.services import practice_service as p,reinforce_service
from tests import test_reinforce_retest as helpers

@pytest.fixture
def setup():
    cls=helpers.ReinforceRetestTests;cls.setUpClass();h=cls();h.setUp()
    user=h._user();h._verified(user);plan,phase,_=h._plan_two_phases(user)
    task=h._task(plan,phase,'阶段A已完成任务');question=h._question(user,task,'触发补强')
    ev=h._evidence(user,phase,question,'wrong')
    extra=h._task(plan,phase,'重做错题：触发补强');h._link(extra,ev)
    h._chunk(user,'阶段A：重做错题：触发补强 的知识资料和关键结论')
    yield h,user,phase,extra,question,ev
    h.tearDown();cls.tearDownClass()

def generate(question):return lambda *a:{'questions':[{'question':question,'answer':'答案','explanation':'解释'}]}

def count(h):return h.session.scalar(select(func.count()).select_from(PracticeQuestion))

@pytest.mark.parametrize('status',['pending','carried'])
def test_retest_pending_blocks_without_model_or_writes(setup,status):
    h,user,phase,task,*_=setup;task.status=status;h.session.commit();before=count(h)
    def forbidden(*a):raise AssertionError('must not call model')
    with pytest.raises(p.PracticeValidationError,match='先完成'):asyncio.run(p.generate_reinforce_retest(h.session,user.id,phase.id,forbidden))
    assert count(h)==before

def test_no_confirmed_link_or_other_account_blocks(setup):
    h,user,phase,task,*_=setup;other=h._user();h._verified(other)
    with pytest.raises(p.PracticeNotFoundError):asyncio.run(p.generate_reinforce_retest(h.session,other.id,phase.id,generate('新题')))
    h.session.query(ReinforceTaskEvidence).delete();h.session.commit()
    with pytest.raises(p.PracticeValidationError,match='没有补强'):asyncio.run(p.generate_reinforce_retest(h.session,user.id,phase.id,generate('新题')))

def test_retest_normalized_duplicates_and_partial_dedup(setup):
    h,user,phase,task,*_=setup;before=count(h)
    with pytest.raises(p.PracticeValidationError,match='重复'):asyncio.run(p.generate_reinforce_retest(h.session,user.id,phase.id,generate('触 发，补 强！')))
    assert count(h)==before
    def model(lines,context):
        assert any('原薄弱作答' in line for line in lines) and any('触发补强' in line for line in lines)
        return {'questions':[{'question':'触 发，补 强！'},{'question':'新的阶段A问题？'},{'question':'新 的 阶段A问题!'}]}
    rows=asyncio.run(p.generate_reinforce_retest(h.session,user.id,phase.id,model))
    assert len(rows)==1 and rows[0].source_task_id==task.id

@pytest.mark.parametrize('failure',['no_source','model','malformed'])
def test_retest_no_heuristic_fallback(setup,failure):
    h,user,phase,*_=setup;before=count(h)
    if failure=='no_source':h.session.query(UserDocument).delete();h.session.commit()
    def model(*a):
        if failure=='model':raise RuntimeError('private failure')
        return {} if failure=='malformed' else {'questions':[{'question':'新题'}]}
    with pytest.raises(p.PracticeValidationError):asyncio.run(p.generate_reinforce_retest(h.session,user.id,phase.id,model))
    assert count(h)==before

def test_after_only_appears_on_new_answer_old_evidence_unchanged(setup):
    h,user,phase,task,question,old=setup
    before=reinforce_service.phase_reinforce_outcome(h.session,user.id,phase.id)
    rows=asyncio.run(p.generate_reinforce_retest(h.session,user.id,phase.id,generate('阶段A的新问法')))
    assert p.practice_evidence(h.session,user.id,rows[0].id)['question']['practiceType']=='reinforce_retest'
    assert p.practice_evidence(h.session,user.id,rows[0].id)['evidence']==[]
    asyncio.run(p.grade_answer(h.session,user.id,rows[0].id,'新作答',grader=lambda *a:{'result':'correct','reason':'答对','error_tag':''}))
    assert h.session.get(MasteryEvidence,old.id).result=='wrong' and h.session.get(PracticeQuestion,question.id).question=='触发补强'
    assert h.session.scalars(select(MasteryEvidence).where(MasteryEvidence.question_id==rows[0].id)).one().knowledge_point==phase.id
    after=reinforce_service.phase_reinforce_outcome(h.session,user.id,phase.id)
    assert before['after']['percent'] is None
    assert after['after']['percent']==100 and after['after']['evidenceCount']==1


def test_history_http_owned_append_current_source_and_deleted_source(setup):
    h,user,phase,task,question,old=setup
    old.source_ref='notes#0';h.session.commit()
    def db():yield h.session
    app.dependency_overrides[get_db]=db;app.dependency_overrides[get_current_user]=lambda:user
    try:
        with TestClient(app) as client:
            url=f'/api/practice/{question.id}/evidence'
            body=client.get(url).json();assert body['evidence'][0]['source']['status']=='available'
            assert datetime.fromisoformat(body['evidence'][0]['createdAt']).utcoffset()==timedelta(0)
            assert '当前' in body['evidence'][0]['source']['label'] and '快照' in body['evidence'][0]['source']['label']
            asyncio.run(p.grade_answer(h.session,user.id,question.id,'第二次回答',grader=lambda *a:{'result':'partial','reason':'旧格式理由保持','error_tag':''}))
            body=client.get(url).json();assert len(body['evidence'])==2
            assert any(item['id']==str(old.id) and item['result']=='wrong' for item in body['evidence'])
            h.session.query(UserDocument).delete();h.session.commit()
            body=client.get(url).json();assert next(item for item in body['evidence'] if item['id']==str(old.id))['source']['status']=='unavailable'
            other=h._user();app.dependency_overrides[get_current_user]=lambda:other
            assert client.get(url).status_code==404
    finally:app.dependency_overrides.clear()

def test_grade_uses_exactly_one_owned_source(setup):
    h,user,*_=setup
    h.session.add(UserDocument(user_id=user.id,doc_id='other-chunk',filename='另一段.txt',file_type='txt',chunk_index=0,content='阶段A：重做错题：触发补强 的第二份资料'))
    h.session.commit()
    text,ref=p._source_for_grade(h.session,user.id,'阶段A：重做错题：触发补强')
    doc,index=ref.rsplit('#',1)
    chunk=h.session.scalar(select(UserDocument).where(UserDocument.user_id==user.id,UserDocument.doc_id==doc,UserDocument.chunk_index==int(index)))
    assert text==chunk.content
