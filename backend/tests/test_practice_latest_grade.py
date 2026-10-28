"""List reads quiz history without confusing it with manual status or explanations."""
import uuid
from datetime import datetime, timezone, timedelta
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from app.models.base import Base
from app.models.entities import User, PracticeQuestion, MasteryEvidence
from app.services.practice_service import list_practice


def test_latest_grade_is_quiz_only_owned_and_deterministic():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        owner = User(username="owner", password_hash="x")
        other = User(username="other", password_hash="x")
        session.add_all([owner, other])
        session.flush()
        now = datetime.now(timezone.utc)
        question = PracticeQuestion(user_id=owner.id, source="uploaded", subject="", question="Q", answer="A", explanation="", status="wrong", created_at=now)
        blank = PracticeQuestion(user_id=owner.id, source="uploaded", subject="", question="blank", answer="", explanation="", status="correct", created_at=now)
        session.add_all([question, blank])
        session.flush()
        def evidence(user, kind, answer, when, identifier):
            return MasteryEvidence(id=uuid.UUID(int=identifier), user_id=user.id, question_id=question.id, evidence_type=kind, result="partial", answer_text=answer, grade_reason="reason", created_at=when)
        session.add_all([
            evidence(owner, "quiz", "old", now-timedelta(days=1), 1),
            evidence(owner, "quiz", "tie lower", now, 2),
            evidence(owner, "quiz", "latest", now, 3),
            evidence(owner, "explanation", "oral", now+timedelta(seconds=1), 4),
            evidence(owner, "composite", "composite", now+timedelta(seconds=2), 5),
            evidence(other, "quiz", "private", now+timedelta(seconds=3), 6),
        ])
        session.commit()
        # Avoid counting ORM expiry reloads as part of list's two queries.
        owner_id = owner.id
        queries = []
        def count(*args): queries.append(1)
        event.listen(engine, "before_cursor_execute", count)
        result = list_practice(session, owner_id, now.date())
        event.remove(engine, "before_cursor_execute", count)
        assert len(queries) == 2
        by_question = {row["question"]: row for row in result["questions"]}
        assert by_question["Q"]["latestGrade"] == {"answerText": "latest", "result": "partial", "reason": "reason"}
        assert by_question["blank"]["latestGrade"] is None
    engine.dispose()
