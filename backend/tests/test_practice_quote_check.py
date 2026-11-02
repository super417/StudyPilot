import asyncio
from unittest.mock import patch
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.models.base import Base
from app.models.entities import User, UserDocument, PracticeQuestion, MasteryEvidence
from app.services.practice_service import grade_answer, practice_evidence, PracticeNotFoundError


def test_literal_quote_and_legacy_and_isolation():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as s:
        user, other = User(username='quote-owner',password_hash='x'), User(username='quote-other',password_hash='x')
        s.add_all([user,other]); s.flush()
        q = PracticeQuestion(user_id=user.id,source='uploaded',subject='x',question='变量是什么',answer='',explanation='',status='pending')
        doc = UserDocument(user_id=user.id,doc_id='doc',filename='x.txt',file_type='txt',chunk_index=0,content='变量是对象的名字。')
        s.add_all([q,doc]); s.flush()
        s.add(MasteryEvidence(user_id=user.id,evidence_type='quiz',result='wrong',question_id=q.id,source_ref='doc#0'))
        s.commit()
        with patch('app.services.practice_service._source_for_grade',return_value=('变量是对象的名字。','doc#0')):
            for quote in ['对象的名字', '不存在的原文', '']:
                grader=lambda *_: {'result':'correct','reason':'说明','source_quote':quote}
                asyncio.run(grade_answer(s,user.id,q.id,'答案',grader))
        with patch('app.services.practice_service._source_for_grade', return_value=('', None)):
            missing = asyncio.run(grade_answer(s,user.id,q.id,'答案',lambda *_: {'result':'correct','reason':'仅凭题目','source_quote':'对象的名字'}))
        assert missing.quote_check == 'insufficient' and missing.source_quote is None
        result=practice_evidence(s,user.id,q.id)['evidence']
        checks=[row['source']['quoteCheck'] for row in result]
        assert checks.count('matched') == 1
        assert checks.count('insufficient') == 3
        assert checks.count('unverified') == 1
        assert next(row for row in result if row['source']['quoteCheck']=='matched')['source']['sourceQuote']=='对象的名字'
        with pytest.raises(PracticeNotFoundError): practice_evidence(s,other.id,q.id)
    engine.dispose()
