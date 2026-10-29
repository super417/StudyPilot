"""Expiring integer micro-point grants and usage settlement; no payment grants."""
import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_CEILING
import httpx
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.models.credits import CreditLot, CreditCall, CreditLedger
from app.services.billing_config import BillingSettings
from app.services.billing_service import BillingError

MICRO = 1000000
MODEL_ID = 'credits:deepseek-flash'


class CreditsSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_prefix='CREDITS_', extra='ignore')
    deepseek_enabled: bool = False


def key():
    try:
        value = json.loads(BillingSettings().provider_keys_json).get('deepseek')
        return value if isinstance(value, str) and value.strip() else None
    except (ValueError, AttributeError):
        return None


def enabled():
    return CreditsSettings().deepseek_enabled and bool(key())


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def month_bounds(now):
    local = utc(now).astimezone(timezone(timedelta(hours=8)))
    end = local.replace(year=local.year + (local.month == 12), month=local.month % 12 + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
    return local.strftime('%Y-%m'), end.astimezone(timezone.utc)


def prepare(session, user_id, now=None):
    now = now or datetime.now(timezone.utc)
    period, end = month_bounds(now)
    grant_id = f'free:{user_id}:{period}'
    if not session.get(CreditLot, grant_id):
        try:
            with session.begin_nested():
                session.add(CreditLot(id=grant_id, user_id=user_id, kind='base', granted=500*MICRO, remaining=500*MICRO, reserved=0, expires_at=end))
                session.add(CreditLedger(id=grant_id, user_id=user_id, kind='monthly_grant', amount=500*MICRO))
                session.flush()
        except IntegrityError:
            pass
    session.flush()
    for call in session.scalars(select(CreditCall).where(CreditCall.user_id == user_id, CreditCall.state == 'reserved', CreditCall.expires_at <= now)).all():
        finish(session, call.id, None, now=now)
    session.commit()
    return end


def amount(input_tokens, output_tokens):
    if any(type(n) is not int or n < 0 for n in (input_tokens, output_tokens)):
        raise BillingError('INVALID_USAGE', '模型未返回有效用量，本次不扣积分')
    # points/million tokens × micro-points/point cancel exactly.
    return int((Decimal(input_tokens)*40 + Decimal(output_tokens)*160).to_integral_value(rounding=ROUND_CEILING))


def reserve(session, user_id, call_id, budget, now=None):
    now = now or datetime.now(timezone.utc)
    prepare(session, user_id, now)
    remaining = budget
    allocations = []
    lots = session.scalars(select(CreditLot).where(CreditLot.user_id == user_id, CreditLot.expires_at > now).order_by(CreditLot.expires_at, CreditLot.kind, CreditLot.id)).all()
    for lot in lots:
        take = min(remaining, lot.remaining-lot.reserved)
        if take <= 0:
            continue
        result = session.execute(update(CreditLot).where(CreditLot.id == lot.id, CreditLot.remaining-CreditLot.reserved >= take).values(reserved=CreditLot.reserved+take), execution_options={'synchronize_session':False})
        if result.rowcount != 1:
            session.rollback()
            raise BillingError('CREDITS_BUSY', '积分状态已变化，请重试')
        allocations.append([lot.id, take])
        remaining -= take
        if not remaining:
            break
    if remaining:
        session.rollback()
        raise BillingError('CREDITS_INSUFFICIENT', '可用积分不足以预留本次调用上限')
    expiry = min([now+timedelta(minutes=10)] + [utc(lot.expires_at) for lot in lots if lot.id in {a[0] for a in allocations}])
    session.add(CreditCall(id=call_id, user_id=user_id, state='reserved', allocations=json.dumps(allocations), input_price='40', output_price='160', charged=0, expires_at=expiry))
    session.commit()


def finish(session, call_id, usage, now=None):
    now = now or datetime.now(timezone.utc)
    call = session.get(CreditCall, call_id)
    if call is None or call.state != 'reserved':
        return False
    if usage is not None and utc(call.expires_at) <= now:
        usage = None
    charge = amount(*usage) if usage else 0
    allocations = json.loads(call.allocations)
    if charge > sum(a[1] for a in allocations):
        raise BillingError('INVALID_USAGE', '用量超过预留上限')
    changed = session.execute(update(CreditCall).where(CreditCall.id == call_id, CreditCall.state == 'reserved').values(state='charged' if usage else 'released', charged=charge, input_tokens=usage[0] if usage else None, output_tokens=usage[1] if usage else None), execution_options={'synchronize_session':False})
    if changed.rowcount != 1:
        session.rollback()
        return False
    remaining = charge
    for lot_id, reserved in allocations:
        take = min(remaining, reserved)
        session.execute(update(CreditLot).where(CreditLot.id == lot_id).values(reserved=CreditLot.reserved-reserved, remaining=CreditLot.remaining-take), execution_options={'synchronize_session':False})
        remaining -= take
    if usage:
        session.add(CreditLedger(id=call_id, user_id=call.user_id, kind='usage', amount=-charge))
    session.commit()
    return usage is not None


async def complete(session, user_id, payload, *, request_id=None, transport=None):
    if not enabled():
        raise BillingError('PLATFORM_UNAVAILABLE', 'DeepSeek 积分模型尚未启用', 503)
    messages = payload.get('messages', [])
    if any(not isinstance(m, dict) or not isinstance(m.get('content'), str) for m in messages):
        raise BillingError('UNSUPPORTED_PLATFORM_CAPABILITY', '积分模式目前支持文本')
    if sum(len(m['content'].encode())+32 for m in messages) > 16000:
        raise BillingError('PLATFORM_INPUT_TOO_LARGE', '上下文超过积分模型上限')
    call_id = request_id or uuid.uuid4().hex
    with Session(bind=session.get_bind(), expire_on_commit=False) as ledger:
        reserve(ledger, user_id, call_id, amount(16000, 4096))
        try:
            body = {**payload, 'messages':messages, 'model':'deepseek-flash', 'stream':False, 'max_tokens':4096, 'thinking':{'type':'disabled'}}
            body.pop('stream_options', None)
            async with httpx.AsyncClient(timeout=60, transport=transport, follow_redirects=False) as client:
                response = await client.post('https://api.deepseek.com/chat/completions', headers={'Authorization':f'Bearer {key()}'}, json=body)
            response.raise_for_status()
            data = response.json()
            usage = data.get('usage') or {}
            counts = (usage.get('prompt_tokens'), usage.get('completion_tokens'))
            amount(*counts)
            if counts[0] > 16000 or counts[1] > 4096:
                raise BillingError('INVALID_USAGE', '用量超过模型上限')
            content = data['choices'][0]['message']['content']
            if not isinstance(content, str) or not content.strip():
                raise BillingError('INVALID_USAGE', '模型没有返回有效文本')
            if not finish(ledger, call_id, counts):
                raise BillingError('CALL_EXPIRED', '本次积分预留已释放')
            return content
        except BaseException as error:
            ledger.rollback()
            finish(ledger, call_id, None)
            if isinstance(error, (BillingError, asyncio.CancelledError, GeneratorExit)):
                raise
            raise BillingError('PLATFORM_AI_FAILED', 'DeepSeek 调用失败，预留积分已释放', 502) from None


def grant_test_qihang(session, user_id, now=None):
    """Local operator-only grant; never a payment or subscription record."""
    period, end = month_bounds(now or datetime.now(timezone.utc))
    for kind in ('test_base', 'test_bonus'):
        grant_id = f'{kind}:{user_id}:{period}'
        if not session.get(CreditLot, grant_id):
            try:
                with session.begin_nested():
                    session.add(CreditLot(id=grant_id,user_id=user_id,kind=kind,granted=2000*MICRO,remaining=2000*MICRO,reserved=0,expires_at=end))
                    session.add(CreditLedger(id=grant_id,user_id=user_id,kind=kind,amount=2000*MICRO))
                    session.flush()
            except IntegrityError:
                pass
    session.commit()
