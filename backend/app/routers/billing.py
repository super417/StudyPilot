from typing import Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field, StrictInt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.billing import BillingLedger, PaymentOrder
from app.models.entities import User
from app.routers.dependencies import get_current_user
from app.services import billing_service as service, payment_gateway
from app.services.billing_config import BillingSettings, platform_models

router = APIRouter(prefix="/api/billing", tags=["billing"])


def error_response(error: service.BillingError):
    return JSONResponse(status_code=error.status, content={"status": "error", "code": error.code, "message": str(error)})


@router.get("/catalog")
def catalog(user: User = Depends(get_current_user)):
    models = platform_models()
    return {"status": "ok", "models": [model.public() for model in models.values()], "channels": [{"id": channel, "available": bool(models) and payment_gateway.channel_available(channel)} for channel in ["alipay", "wechat"]], "platformAvailable": bool(models), "supportedCapabilities": ["assistant_chat", "planning", "diagnosis", "practice"]}


@router.get("/account")
def read_account(user: User = Depends(get_current_user), session: Session = Depends(get_db)):
    row = service.account(session, user.id)
    service.expire_calls(session, user.id)
    session.commit()
    session.refresh(row)
    ledger = session.scalars(select(BillingLedger).where(BillingLedger.user_id == user.id).order_by(BillingLedger.created_at.desc()).limit(30)).all()
    orders = session.scalars(select(PaymentOrder).where(PaymentOrder.user_id == user.id).order_by(PaymentOrder.created_at.desc()).limit(20)).all()
    return {"status": "ok", "mode": row.mode, "modelId": row.model_id, "balanceMicros": row.balance_micros, "reservedMicros": row.reserved_micros, "availableMicros": row.balance_micros - row.reserved_micros, "ledger": [{"id": item.id, "kind": item.kind, "amountMicros": item.amount_micros, "createdAt": item.created_at.isoformat(), "description": item.description} for item in ledger], "orders": [service.order_public(item) for item in orders]}


class Preferences(BaseModel):
    mode: Literal["byok", "platform"]
    modelId: str | None = Field(default=None, max_length=128)


@router.put("/preferences")
def preferences(payload: Preferences, user: User = Depends(get_current_user), session: Session = Depends(get_db)):
    if payload.mode == "platform" and payload.modelId not in platform_models():
        return error_response(service.BillingError("PLATFORM_UNAVAILABLE", "该平台模型尚未配置完成", 503))
    row = service.account(session, user.id)
    row.mode, row.model_id = payload.mode, payload.modelId if payload.mode == "platform" else None
    session.commit()
    return {"status": "ok", "mode": row.mode, "modelId": row.model_id}


class OrderPayload(BaseModel):
    amountFen: StrictInt = Field(ge=100, le=100000)
    channel: Literal["alipay", "wechat"]
    idempotencyKey: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")


@router.post("/orders")
async def create_order(payload: OrderPayload, user: User = Depends(get_current_user), session: Session = Depends(get_db)):
    try:
        row = await service.create_order(session, user.id, payload.amountFen, payload.channel, payload.idempotencyKey)
        return {"status": "ok", "order": service.order_public(row)}
    except service.BillingError as error:
        return error_response(error)


@router.get("/orders/{order_id}")
def get_order(order_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_db)):
    try:
        return {"status": "ok", "order": service.order_public(service.owned_order(session, user.id, order_id))}
    except service.BillingError as error:
        return error_response(error)


@router.post("/orders/{order_id}/query")
async def query_order(order_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_db)):
    try:
        row = await service.query_order(session, user.id, order_id)
        return {"status": "ok", "order": service.order_public(row)}
    except service.BillingError as error:
        return error_response(error)


@router.post("/notify/alipay")
async def alipay_notify(request: Request, session: Session = Depends(get_db)):
    try:
        s = BillingSettings()
        if not payment_gateway.channel_available("alipay", s):
            raise ValueError()
        form = await request.form()
        if len(form.multi_items()) != len(form):
            raise ValueError()
        data = payment_gateway.verify_alipay_notify(dict(form), s)
        service.accept_payment(session, "alipay", data, s)
        return PlainTextResponse("success")
    except Exception:
        session.rollback()
        return PlainTextResponse("failure", status_code=400)


@router.post("/notify/wechat")
async def wechat_notify(request: Request, session: Session = Depends(get_db)):
    try:
        s = BillingSettings()
        if not payment_gateway.channel_available("wechat", s):
            raise ValueError()
        raw = await request.body()
        if len(raw) > 65536:
            raise ValueError()
        data = payment_gateway.decrypt_wechat_notify(raw, request.headers, s)
        service.accept_payment(session, "wechat", data, s)
        return Response(status_code=204)
    except Exception:
        session.rollback()
        return JSONResponse(status_code=400, content={"code": "FAIL", "message": "通知核验失败"})
