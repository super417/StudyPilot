from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models.base import Base
from app.models.entities import CheckIn, DailyTask, Phase, Plan, User
from app.routers.weekly_reviews import _review
from app.services.weekly_review_service import generate_weekly_review


def test_existing_weekly_review_uses_current_records():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        user = User(username="weekly-live-test", password_hash="x")
        session.add(user)
        session.flush()
        start, end = date(2025, 2, 10), date(2025, 2, 16)
        assert generate_weekly_review(session, user.id, start, end) is None
        plan = Plan(user_id=user.id, goal_name="test", start_date=start, goal_date=end,
                    current_level="beginner", daily_minutes=30, total_phases=2)
        session.add(plan)
        session.flush()
        phase = Phase(plan_id=plan.id, phase_index=1, name="test", start_date=start, end_date=end)
        session.add(phase)
        session.flush()
        task = DailyTask(plan_id=plan.id, phase_id=phase.id, task_date=start,
                         week_label="W07", description="test", status="pending")
        session.add_all([task, CheckIn(user_id=user.id, check_date=start, duration_minutes=30, difficulty=3, energy=3)])
        session.commit()
        review = generate_weekly_review(session, user.id, start, end)
        assert _review(session, user.id, review)["totalMinutes"] == 30
        task.status = "done"
        session.add(CheckIn(user_id=user.id, check_date=date(2025, 2, 11), duration_minutes=60, difficulty=3, energy=3))
        session.commit()
        actual = _review(session, user.id, review)
        assert actual["totalsSource"] == "live"
        assert (actual["totalMinutes"], actual["completionRate"], actual["streakDays"]) == (90, 100, 2)
        assert review.total_minutes == 30  # original snapshot is not rewritten
    engine.dispose()
