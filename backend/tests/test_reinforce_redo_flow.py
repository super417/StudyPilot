import asyncio
from sqlalchemy import select
from app.models.entities import DailyTask, MasteryEvidence, PracticeQuestion
from app.services import practice_service, reinforce_service
from tests import test_reinforce_service as helpers


def test_confirm_creates_blank_redo_and_correct_answer_completes_task():
    Helpers = helpers.ReinforceServiceTests
    Helpers.setUpClass()
    h = Helpers()
    h.setUp()
    try:
        user, plan, phase, original, evidence = h._divergent_with_wrong(source_ref=None)
        preview = reinforce_service.create_reinforce_preview(h.session, user.id, plan.id, today=h.today)
        confirmed = reinforce_service.confirm_reinforce(h.session, user.id, plan.id, preview.id, expected_selection_version=1)
        task_ids = confirmed.applied_record['createdTaskIds']
        import uuid
        task_ids = [uuid.UUID(value) for value in task_ids]
        copies = list(h.session.scalars(select(PracticeQuestion).where(PracticeQuestion.source_task_id.in_(task_ids))))
        copy = next(q for q in copies if q.question == original.question)
        assert copy.id != original.id and copy.status == 'pending'
        assert h.session.scalar(select(MasteryEvidence).where(MasteryEvidence.question_id == copy.id)) is None
        listing = practice_service.list_practice(h.session, user.id, copy.created_at.date())
        card = next(q for q in listing['questions'] if q['id'] == str(copy.id))
        assert card['practiceType'] == 'reinforce_redo' and card['latestGrade'] is None
        asyncio.run(practice_service.grade_answer(h.session, user.id, copy.id, '连续', grader=lambda *args: {'result': 'correct', 'reason': '测试判分', 'error_tag': ''}))
        assert h.session.get(DailyTask, copy.source_task_id).status == 'done'
        assert h.session.get(MasteryEvidence, evidence.id).result == 'wrong'
        assert original.status == 'wrong'
        assert practice_service.practice_evidence(h.session, user.id, copy.id)['question']['practiceType'] == 'reinforce_redo'
        untouched_ids = [q.id for q in copies if q.id != copy.id]
        reinforce_service.undo_reinforce(h.session, user.id, plan.id)
        h.session.expire_all()
        assert h.session.get(PracticeQuestion, copy.id).source_task_id is None
        assert all(h.session.get(PracticeQuestion, qid) is None for qid in untouched_ids)
        assert h.session.scalar(select(MasteryEvidence).where(MasteryEvidence.question_id == copy.id)) is not None
    finally:
        h.tearDown()
        Helpers.tearDownClass()


def test_today_list_excludes_questions_from_another_plan():
    Helpers = helpers.ReinforceServiceTests
    Helpers.setUpClass()
    h = Helpers()
    h.setUp()
    try:
        user, old_plan, phase, old_question, _ = h._divergent_with_wrong(source_ref=None)
        old_question.source_task_id = h.session.scalar(select(DailyTask.id).where(DailyTask.plan_id == old_plan.id))
        h.session.commit()
        current_plan, current_phase = h._plan_phase(user)
        h._tasks(current_plan, current_phase, done=0, total=1)
        current_task = h.session.scalar(select(DailyTask).where(DailyTask.plan_id == current_plan.id))
        current = h._question(user, '当前计划题')
        current.source_task_id = current_task.id
        h.session.commit()
        listing = practice_service.list_practice(h.session, user.id, current.created_at.date())
        ids = {q['id'] for q in listing['questions']}
        assert str(current.id) in ids
        assert str(old_question.id) not in ids
    finally:
        h.tearDown()
        Helpers.tearDownClass()
