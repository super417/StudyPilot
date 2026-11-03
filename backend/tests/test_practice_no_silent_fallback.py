import asyncio
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.services import practice_service as service


@pytest.mark.parametrize('phase_quiz', [False, True])
def test_generation_failure_does_not_save_fallback(monkeypatch, phase_quiz):
    session = MagicMock()
    session.scalars.return_value = iter(['doc'])
    monkeypatch.setattr(service, 'require_ai_access', lambda *args: None)
    monkeypatch.setattr(service.document_service, 'build_context', lambda *args, **kwargs: ('资料内容', []))
    monkeypatch.setattr(service, '_done_task_lines', lambda *args: (['任务'], uuid4()))
    monkeypatch.setattr(service, '_done_tasks_for_phase', lambda *args: (SimpleNamespace(name='阶段'), [SimpleNamespace(description='任务', id=uuid4())]))

    def failing_generator(*args):
        raise RuntimeError('upstream unavailable')

    with pytest.raises(service.PracticeValidationError, match='没有保存题目'):
        if phase_quiz:
            asyncio.run(service.generate_phase_quiz(session, uuid4(), uuid4(), failing_generator))
        else:
            asyncio.run(service.generate_for_day(session, uuid4(), date.today(), failing_generator))
    session.add_all.assert_not_called()
    session.commit.assert_not_called()
