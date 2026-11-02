from datetime import date
import asyncio
import pytest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models.base import Base
from app.models.entities import DailyTask, Mistake, Phase, Plan, User
from app.routers.study import DailySelectionPayload, get_daily_selection, put_daily_selection, mark_selection_learned
from app.services import practice_service, task_service
from sqlalchemy import select


def test_selection_keeps_original_task_date_and_is_user_scoped():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        user = User(username='selection-user', password_hash='x')
        other = User(username='selection-other', password_hash='x')
        session.add_all([user, other])
        session.flush()
        plan = Plan(user_id=user.id, goal_name='Python', start_date=date(2026, 1, 1), goal_date=date(2026, 12, 31), current_level='beginner', daily_minutes=30, total_phases=2)
        session.add(plan)
        session.flush()
        phase = Phase(plan_id=plan.id, phase_index=1, name='Python', start_date=plan.start_date, end_date=plan.goal_date)
        session.add(phase)
        session.flush()
        task = DailyTask(plan_id=plan.id, phase_id=phase.id, task_date=date(2026, 11, 5), week_label='W45', description='变量', status='pending')
        session.add(task)
        session.commit()
        payload = DailySelectionPayload(date='2026-11-02', taskIds=[str(task.id)], minutes=30)
        assert put_daily_selection(payload, user, session)['tasks'][0]['id'] == str(task.id)
        assert get_daily_selection('2026-11-02', other, session)['tasks'] == []
        assert task.task_date == date(2026, 11, 5)
        assert put_daily_selection(payload, other, session).status_code == 400
    engine.dispose()


def test_two_tasks_are_graded_independently_and_errors_are_recorded(monkeypatch):
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    monkeypatch.setattr(practice_service, 'require_ai_access', lambda *args: None)
    monkeypatch.setattr(practice_service.document_service, 'build_context', lambda *args, **kwargs: ('相关资料', []))
    monkeypatch.setattr(practice_service, '_refs_for_question', lambda *args: None)
    with Session(engine, expire_on_commit=False) as session:
        user = User(username='loop-user', password_hash='x')
        session.add(user)
        session.flush()
        plan = Plan(user_id=user.id, goal_name='Python', start_date=date(2026, 1, 1), goal_date=date(2026, 12, 31), current_level='beginner', daily_minutes=30, total_phases=2)
        session.add(plan)
        session.flush()
        phase = Phase(plan_id=plan.id, phase_index=1, name='Python', start_date=plan.start_date, end_date=plan.goal_date)
        session.add(phase)
        session.flush()
        tasks = [DailyTask(plan_id=plan.id, phase_id=phase.id, task_date=date(2026, 11, 5), week_label='W45', description=description, status='pending') for description in ('变量', '列表')]
        session.add_all(tasks)
        session.commit()
        put_daily_selection(DailySelectionPayload(date='2026-11-02', taskIds=[str(task.id) for task in tasks], minutes=30), user, session)
        for task in tasks:
            mark_selection_learned(str(task.id), '2026-11-02', user, session)
        assert task_service.phase_progress(session, phase.id) == 0
        with pytest.raises(task_service.TaskStatusValidationError):
            task_service.set_task_status(session, user.id, tasks[0].id, 'done')
        assert task_service.protected_practice_task_ids(session, plan.id, user.id) == {task.id for task in tasks}
        # Exercise source retrieval requires at least one document id.
        from app.services import practice_service as service
        # A real document row is unnecessary for this test; supply a context via a focused fake query.
        from unittest.mock import patch
        real_scalars = session.scalars
        def scalars(statement, *args, **kwargs):
            if 'user_documents.doc_id' in str(statement):
                return iter(['doc'])
            return real_scalars(statement, *args, **kwargs)
        generator = lambda lines, context: {'questions': [{'question': lines[0] + suffix, 'answer': '正确', 'explanation': '解释'} for suffix in ('是什么？', '怎么用？')]}
        with patch.object(session, 'scalars', side_effect=scalars):
            questions = asyncio.run(service.generate_selected_for_day(session, user.id, date(2026, 11, 2), generator))
        assert {q.source_task_id for q in questions} == {task.id for task in tasks}
        grader = lambda result: lambda *_: {'result': result, 'reason': '判分依据', 'error_tag': 'concept'}
        asyncio.run(service.grade_answer(session, user.id, questions[0].id, '正确', grader=grader('correct')))
        assert tasks[0].status == 'pending' and task_service.phase_progress(session, phase.id) == 0
        asyncio.run(service.grade_answer(session, user.id, questions[1].id, '正确', grader=grader('correct')))
        assert tasks[0].status == 'done' and tasks[1].status == 'pending'
        assert task_service.phase_progress(session, phase.id) == 50
        asyncio.run(service.grade_answer(session, user.id, questions[2].id, '', grader=grader('wrong')))
        states = get_daily_selection('2026-11-02', user, session)['tasks']
        assert [item['learningState'] for item in states] == ['done', 'reinforce']
        assert len(list(session.scalars(select(Mistake)))) == 1
        assert tasks[1].status == 'pending'
        asyncio.run(service.grade_answer(session, user.id, questions[2].id, '正确', grader=grader('correct')))
        assert tasks[1].status == 'pending'
        asyncio.run(service.grade_answer(session, user.id, questions[3].id, '正确', grader=grader('correct')))
        assert tasks[1].status == 'done'
        assert task_service.phase_progress(session, phase.id) == 100
    engine.dispose()
