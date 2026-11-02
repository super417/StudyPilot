import asyncio

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.models.base import Base
from app.models.entities import MasteryEvidence, Mistake, PracticeQuestion, User
from app.services.practice_service import grade_answer


def test_wrong_and_partial_grades_update_one_mistake():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        user = User(username='grade-mistake-test', password_hash='x')
        session.add(user)
        session.flush()
        question = PracticeQuestion(user_id=user.id, source='uploaded', question='1 + 1?', answer='2', subject='math', status='pending')
        session.add(question)
        session.commit()
        def grade(result):
            return lambda *_: {'result': result, 'reason': '需要复习', 'error_tag': 'concept'}
        asyncio.run(grade_answer(session, user.id, question.id, '3', grader=grade('wrong')))
        asyncio.run(grade_answer(session, user.id, question.id, '1', grader=grade('partial')))
        mistakes = list(session.scalars(select(Mistake)))
        assert len(mistakes) == 1
        assert mistakes[0].my_answer == '1'
        assert mistakes[0].correct_understanding == '2'
        assert mistakes[0].review_status == 'pending'
        assert len(list(session.scalars(select(MasteryEvidence)))) == 2
    engine.dispose()
