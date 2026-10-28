from datetime import date, datetime, timedelta, timezone
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import get_db
from app.models.base import Base
from app.models.entities import User, Plan, PlanAdjustment
from app.routers.dependencies import get_current_user
from app.routers.plans import router


@pytest.fixture
def undo_client():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(username='undo-owner', password_hash='x')
        other = User(username='undo-other', password_hash='x')
        session.add_all([user, other])
        session.flush()
        plan = Plan(user_id=user.id, goal_name='学习', start_date=date.today(),
                    goal_date=date.today() + timedelta(days=30), current_level='基础',
                    daily_minutes=30, total_phases=2)
        session.add(plan)
        session.commit()
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: session
        app.dependency_overrides[get_current_user] = lambda: user
        with TestClient(app) as client:
            yield client, session, plan, other, app
    engine.dispose()


def test_visibility_tracks_latest_record_without_writes(undo_client):
    client, session, plan, other, app = undo_client
    url = f'/api/plans/{plan.id}/adjustments/undo-availability'
    assert client.get(url).json()['hasConfirmedAdjustment'] is False
    now = datetime.now(timezone.utc)

    def add(status, offset):
        when = now + timedelta(seconds=offset)
        row = PlanAdjustment(user_id=plan.user_id, plan_id=plan.id, status=status,
                             basis_fingerprint='x', proposal={}, diff={}, validation={},
                             steps=[], evidence_refs=[], created_at=when, updated_at=when)
        session.add(row)
        session.commit()
        return row

    old = add('confirmed', 0)
    assert client.get(url).json()['hasConfirmedAdjustment'] is True
    add('pending', 1)
    assert client.get(url).json()['hasConfirmedAdjustment'] is True
    latest = add('undone', 2)
    assert client.get(url).json()['hasConfirmedAdjustment'] is False
    session.refresh(old)
    session.refresh(latest)
    assert old.status == 'confirmed'
    assert latest.status == 'undone'
    app.dependency_overrides[get_current_user] = lambda: other
    assert client.get(url).status_code == 404


@pytest.mark.parametrize('plan_id', ['invalid', str(uuid.uuid4())])
def test_unknown_plan_is_404(undo_client, plan_id):
    client, *_ = undo_client
    assert client.get(f'/api/plans/{plan_id}/adjustments/undo-availability').status_code == 404
