"""Atomic balance transitions shared by authenticated routes and payment callbacks."""
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_CEILING

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.billing import BillingAccount, BillingCall, BillingLedger, PaymentOrder
from .billing_config import BillingSettings, platform_models
from . import payment_gateway


class BillingError(RuntimeError):
    def __init__(self, code: str, message: str, status: int = 400):
        self.code, self.status = code, status
        super().__init__(message)


def account(session: Session, user_id) -> BillingAccount:
    row = session.get(BillingAccount, user_id)
    if row is None:
        try:
            with session.begin_nested():
                row = BillingAccount(user_id=user_id)
                session.add(row)
                session.flush()
        except IntegrityError:
            row = session.get(BillingAccount, user_id)
    return row


def selected_mode(session: Session, user_id) -> str:
    row = session.get(BillingAccount, user_id)
    return row.mode if row else "byok"


def cost_micros(input_tokens: int, output_tokens: int, input_price: Decimal, output_price: Decimal) -> int:
    # price is yuan / 1,000,000 tokens; 1 yuan = 1,000,000 micro-yuan.
    if any(type(value) is not int or value < 0 for value in [input_tokens, output_tokens]):
        raise BillingError("INVALID_USAGE", "模型未提供有效用量，未扣费")
    return int((input_price * input_tokens + output_price * output_tokens).to_integral_value(rounding=ROUND_CEILING))


def expire_calls(session: Session, user_id) -> None:
    rows = session.scalars(select(BillingCall).where(BillingCall.user_id == user_id, BillingCall.state == "reserved", BillingCall.expires_at < datetime.now(timezone.utc))).all()
    for row in rows:
        finish_call(session, row.id, None, commit=False)


def reserve_call(session: Session, user_id, model, request_id: str) -> BillingCall:
    account(session, user_id)
    expire_calls(session, user_id)
    budget = cost_micros(model.max_input_tokens, model.max_output_tokens, model.input_price, model.output_price)
    if budget > 100000000:  # single request hard ceiling: 100 yuan, regardless of catalog mistakes
        raise BillingError("CALL_BUDGET_TOO_HIGH", "模型单次预算超过平台上限，请联系管理员", 503)
    existing = session.get(BillingCall, request_id)
    if existing:
        raise BillingError("CALL_ALREADY_STARTED", "本次请求已经处理，请勿重复提交", 409)
    result = session.execute(update(BillingAccount).where(BillingAccount.user_id == user_id, BillingAccount.balance_micros - BillingAccount.reserved_micros >= budget).values(reserved_micros=BillingAccount.reserved_micros + budget))
    if result.rowcount != 1:
        session.rollback()
        raise BillingError("PLATFORM_INSUFFICIENT_BALANCE", "平台可用余额不足以预留本次调用上限，请充值或切换自带 Key", 402)
    row = BillingCall(id=request_id, user_id=user_id, model_id=model.id, input_price=str(model.input_price), output_price=str(model.output_price), reserved_micros=budget, expires_at=datetime.now(timezone.utc) + timedelta(minutes=10))
    session.add(row)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise BillingError("CALL_ALREADY_STARTED", "本次请求已经处理，请勿重复提交", 409) from None
    return row


def finish_call(session: Session, request_id: str, settlement: tuple[int, int, int] | None, *, commit=True) -> bool:
    row = session.get(BillingCall, request_id)
    if row is None:
        raise BillingError("CALL_NOT_FOUND", "调用记录不存在", 404)
    amount, input_tokens, output_tokens = settlement if settlement else (0, None, None)
    if type(amount) is not int or not 0 <= amount <= row.reserved_micros:
        raise BillingError("INVALID_USAGE", "模型用量超出本次预算，未扣费")
    changed = session.execute(update(BillingCall).where(BillingCall.id == request_id, BillingCall.state == "reserved").values(state="settled" if settlement else "released", charged_micros=amount, input_tokens=input_tokens, output_tokens=output_tokens))
    if changed.rowcount:
        session.execute(update(BillingAccount).where(BillingAccount.user_id == row.user_id).values(balance_micros=BillingAccount.balance_micros - amount, reserved_micros=BillingAccount.reserved_micros - row.reserved_micros))
        session.add(BillingLedger(user_id=row.user_id, reference=f"call:{request_id}", kind="ai_charge" if settlement else "ai_release", amount_micros=-amount, description=f"{row.model_id} · {input_tokens} 输入 / {output_tokens} 输出 token" if settlement else "调用未完成或用量不可核验，已释放预留"))
    if commit:
        session.commit()
    return bool(changed.rowcount)


def owned_order(session: Session, user_id, order_id: str) -> PaymentOrder:
    row = session.get(PaymentOrder, order_id)
    if row is None or row.user_id != user_id:
        raise BillingError("ORDER_NOT_FOUND", "订单不存在", 404)
    return row


def order_public(row: PaymentOrder) -> dict:
    return {"id": row.id, "channel": row.channel, "amountFen": row.amount_fen, "state": row.state, "paymentUrl": row.payment_url, "codeUrl": row.code_url, "createdAt": row.created_at.isoformat()}


async def create_order(session: Session, user_id, amount_fen: int, channel: str, key: str, settings=None, transport=None) -> PaymentOrder:
    s = settings or BillingSettings()
    existing = session.scalar(select(PaymentOrder).where(PaymentOrder.user_id == user_id, PaymentOrder.idempotency_key == key))
    if existing:
        if existing.amount_fen != amount_fen or existing.channel != channel:
            raise BillingError("IDEMPOTENCY_CONFLICT", "重复请求的金额或渠道不一致", 409)
        return existing
    if type(amount_fen) is not int or not 100 <= amount_fen <= 100000 or channel not in {"alipay", "wechat"} or not 8 <= len(key) <= 80:
        raise BillingError("INVALID_ORDER", "请选择 1—1000 元充值金额和有效渠道")
    if not platform_models(s) or not payment_gateway.channel_available(channel, s):
        raise BillingError("PAYMENT_UNAVAILABLE", "该充值渠道尚未配置完成，暂不能收款", 503)
    account(session, user_id)
    row = PaymentOrder(id=uuid.uuid4().hex, user_id=user_id, amount_fen=amount_fen, channel=channel, idempotency_key=key)
    session.add(row)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        return await create_order(session, user_id, amount_fen, channel, key, s, transport)
    try:
        row.payment_url, row.code_url = await payment_gateway.create_payment(row, s, transport)
        session.commit()
    except Exception:
        session.rollback()
        # The provider may have received the order. Keep it pending for verified query;
        # never retry a creation automatically after an ambiguous network failure.
        raise BillingError("PAYMENT_CREATE_FAILED", "付款信息暂未取得，请稍后查询此订单，勿重复支付", 502) from None
    return row


def accept_payment(session: Session, channel: str, data: dict, settings=None, *, queried_order_id: str | None = None) -> None:
    s = settings or BillingSettings()
    order_id = data.get("out_trade_no")
    row = session.get(PaymentOrder, order_id) if isinstance(order_id, str) else None
    if row is None or row.channel != channel:
        raise BillingError("INVALID_PAYMENT", "支付订单不匹配")
    session.refresh(row)
    try:
        if channel == "alipay":
            # Only query_order may supply queried_order_id, after a merchant-signed
            # request and verified Alipay response. Query responses omit merchant
            # identity fields; notifications must always carry both explicitly.
            queried = queried_order_id is not None and queried_order_id == order_id
            app_matches = data.get("app_id") == s.alipay_app_id or (queried and "app_id" not in data)
            seller_matches = data.get("seller_id") == s.alipay_seller_id or (queried and "seller_id" not in data)
            if not app_matches or not seller_matches or data.get("trade_status") not in {"TRADE_SUCCESS", "TRADE_FINISHED"} or data.get("trans_currency", "CNY") != "CNY":
                raise ValueError()
            fen = Decimal(data["total_amount"]) * 100
            if not fen.is_finite() or fen != fen.to_integral_value():
                raise ValueError()
            amount, transaction = int(fen), data["trade_no"]
        else:
            if data.get("appid") != s.wechat_app_id or data.get("mchid") != s.wechat_mchid or data.get("trade_state") != "SUCCESS" or data["amount"].get("currency") != "CNY":
                raise ValueError()
            amount, transaction = data["amount"]["total"], data["transaction_id"]
            if type(amount) is not int:
                raise ValueError()
        if amount != row.amount_fen or not isinstance(transaction, str) or not 1 <= len(transaction) <= 100:
            raise ValueError()
    except (ValueError, TypeError, KeyError, ArithmeticError):
        raise BillingError("INVALID_PAYMENT", "支付身份、金额或状态不匹配") from None
    reference = f"{channel}:{transaction}"
    if row.state == "paid":
        if row.transaction_id != reference:
            raise BillingError("INVALID_PAYMENT", "支付流水不匹配")
        return
    try:
        changed = session.execute(update(PaymentOrder).where(PaymentOrder.id == row.id, PaymentOrder.state == "pending").values(state="paid", transaction_id=reference))
        if changed.rowcount:
            account(session, row.user_id)
            session.execute(update(BillingAccount).where(BillingAccount.user_id == row.user_id).values(balance_micros=BillingAccount.balance_micros + amount * 10000))
            session.add(BillingLedger(user_id=row.user_id, reference=f"order:{row.id}", kind="recharge", amount_micros=amount * 10000, description="支付宝充值" if channel == "alipay" else "微信支付充值"))
        session.commit()
    except IntegrityError:
        session.rollback()
        raise BillingError("INVALID_PAYMENT", "支付流水重复或冲突") from None


async def query_order(session, user_id, order_id, settings=None, transport=None):
    s = settings or BillingSettings()
    row = owned_order(session, user_id, order_id)
    if row.state == "paid":
        return row
    if not payment_gateway.channel_available(row.channel, s):
        raise BillingError("PAYMENT_UNAVAILABLE", "该支付渠道暂不可用", 503)
    try:
        result = await payment_gateway.query_payment(row, s, transport)
    except Exception:
        raise BillingError("PAYMENT_QUERY_FAILED", "暂时无法核验订单，请稍后重试", 502) from None
    paid = result.get("trade_state") == "SUCCESS" if row.channel == "wechat" else result.get("trade_status") in {"TRADE_SUCCESS", "TRADE_FINISHED"}
    if paid:
        if result.get("out_trade_no") != row.id:
            raise BillingError("INVALID_PAYMENT", "查询结果与订单不匹配")
        accept_payment(session, row.channel, result, s, queried_order_id=row.id)
        session.refresh(row)
    return row
