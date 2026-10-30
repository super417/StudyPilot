"""Operator review grants: temporary SQLite only, no payment or live model calls."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import uuid4
import pytest
from pydantic import ValidationError
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.models.credits import CreditLot, CreditLedger
from app.models.entities import User
from app.services import credits_service as s
from tests.test_platform_billing import db

@pytest.fixture
def review(db,monkeypatch,tmp_path):
    session,user=db
    # Never inherit an operator's real .env review eligibility in these tests.
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('CREDITS_REVIEW_USER_ID',str(user.id))
    monkeypatch.setenv('CREDITS_REVIEW_UNTIL','2027-10-30T00:00:00+08:00')
    return session,user

def paid(session,user):
    return session.scalars(select(CreditLot).where(CreditLot.user_id==user.id,CreditLot.kind.in_(['test_base','test_bonus']))).all()

def test_monthly_gifts_idempotent_across_month_and_year(review):
    session,user=review
    for now in [datetime(2026,10,30,tzinfo=timezone.utc),datetime(2026,11,1,tzinfo=timezone.utc),datetime(2026,12,31,16,tzinfo=timezone.utc)]:
        before=len(paid(session,user))
        s.prepare(session,user.id,now);s.prepare(session,user.id,now)
        rows=paid(session,user)
        assert len(rows)==before+2
        _,end=s.month_bounds(now)
        assert sum(row.remaining for row in rows if s.utc(row.expires_at)==end)==4000*s.MICRO
    assert session.scalar(select(func.count()).select_from(CreditLedger).where(CreditLedger.user_id==user.id))==6

def test_cutoff_and_non_target(review):
    session,user=review
    cutoff=datetime(2027,10,29,16,tzinfo=timezone.utc)
    other=User(id=uuid4(),username='unrelated',password_hash='fixture');session.add(other);session.commit()
    s.prepare(session,other.id,cutoff-timedelta(seconds=1));assert paid(session,other)==[]
    s.prepare(session,user.id,cutoff-timedelta(seconds=1))
    rows=paid(session,user)
    assert len(rows)==2 and all(s.utc(row.expires_at)==cutoff for row in rows)
    before=[(r.id,r.remaining,r.expires_at) for r in rows]
    s.prepare(session,user.id,cutoff);s.prepare(session,user.id,cutoff+timedelta(days=4))
    assert [(r.id,r.remaining,r.expires_at) for r in paid(session,user)]==before
    assert s.spendable_lots(session,user.id,cutoff)==[]

def test_existing_month_batches_unchanged(review):
    session,user=review;now=datetime(2026,10,30,tzinfo=timezone.utc)
    s.grant_test_qihang(session,user.id,now)
    rows=paid(session,user);rows[0].remaining-=123;session.commit()
    before=[(r.id,r.remaining,r.expires_at) for r in rows]
    s.prepare(session,user.id,now)
    assert [(r.id,r.remaining,r.expires_at) for r in paid(session,user)]==before
    assert session.scalar(select(func.count()).select_from(CreditLedger))==2

def test_concurrent_first_read_creates_exactly_two_grants(review):
    session,user=review;engine=session.get_bind();now=datetime(2026,10,30,tzinfo=timezone.utc)
    def read(_):
        with Session(engine) as local:s.prepare(local,user.id,now)
    with ThreadPoolExecutor(max_workers=6) as pool:list(pool.map(read,range(12)))
    session.expire_all()
    assert len(paid(session,user))==2
    assert sum(row.remaining for row in paid(session,user))==4000*s.MICRO
    assert session.scalar(select(func.count()).select_from(CreditLedger))==2

@pytest.mark.parametrize('missing',['CREDITS_REVIEW_USER_ID','CREDITS_REVIEW_UNTIL'])
def test_partial_configuration_does_not_grant(review,monkeypatch,missing):
    session,user=review;monkeypatch.delenv(missing)
    s.prepare(session,user.id,datetime(2026,10,30,tzinfo=timezone.utc))
    assert paid(session,user)==[]

def test_requires_timezone_and_uuid(monkeypatch):
    monkeypatch.setenv('CREDITS_REVIEW_UNTIL','2027-10-30T00:00:00')
    with pytest.raises(ValidationError):s.CreditsSettings(_env_file=None)
    monkeypatch.setenv('CREDITS_REVIEW_UNTIL','2027-10-30T00:00:00+08:00')
    monkeypatch.setenv('CREDITS_REVIEW_USER_ID','super')
    with pytest.raises(ValidationError):s.CreditsSettings(_env_file=None)
