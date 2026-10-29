from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.entities import User
from app.models.credits import CreditLot, CreditLedger
from app.routers.dependencies import get_current_user
from app.services import credits_service as service
from app.services.billing_service import account
from app.routers.billing import error_response

router = APIRouter(prefix='/api/credits', tags=['credits'])


@router.get('/catalog')
def catalog(user: User = Depends(get_current_user)):
    available = service.enabled()
    return {'status':'ok', 'platformAvailable':available, 'models':[{'id':service.MODEL_ID, 'provider':'deepseek', 'displayName':'DeepSeek Flash', 'inputPointsPerMillion':'40', 'outputPointsPerMillion':'160', 'maxInputTokens':16000, 'maxOutputTokens':4096}] if available else [], 'plans':[{'id':'free','name':'免费版','priceFen':0,'basePoints':500,'bonusPoints':0,'purchaseAvailable':False},{'id':'qihang','name':'启航版','priceFen':9900,'recurringMonthPriceFen':7000,'recurringYearPriceFen':67200,'basePoints':2000,'bonusPoints':2000,'purchaseAvailable':False},{'id':'supply','name':'补给包','priceFen':5000,'basePoints':1000,'bonusPoints':0,'purchaseAvailable':False}]}


@router.get('/account')
def read_account(user: User = Depends(get_current_user), session: Session = Depends(get_db)):
    with Session(bind=session.get_bind(), expire_on_commit=False) as ledger:
        end = service.prepare(ledger, user.id)
        now = datetime.now(timezone.utc)
        row = account(ledger, user.id)
        lots = ledger.scalars(select(CreditLot).where(CreditLot.user_id == user.id, CreditLot.expires_at > now).order_by(CreditLot.expires_at)).all()
        entries = ledger.scalars(select(CreditLedger).where(CreditLedger.user_id == user.id).order_by(CreditLedger.created_at.desc()).limit(30)).all()
        return {'testPlan':any(l.kind.startswith('test_') for l in lots), 'planName':'启航版（测试）' if any(l.kind.startswith('test_') for l in lots) else '免费版', 'status':'ok', 'mode':row.mode, 'modelId':row.model_id, 'availableMicroPoints':sum(l.remaining-l.reserved for l in lots), 'reservedMicroPoints':sum(l.reserved for l in lots), 'nextRefreshAt':end.isoformat(), 'lots':[{'id':l.id,'kind':l.kind,'grantedMicroPoints':l.granted,'remainingMicroPoints':l.remaining,'reservedMicroPoints':l.reserved,'expiresAt':service.utc(l.expires_at).isoformat()} for l in lots], 'ledger':[{'id':e.id,'kind':e.kind,'amountMicroPoints':e.amount,'createdAt':service.utc(e.created_at).isoformat()} for e in entries]}


class Preferences(BaseModel):
    mode: Literal['byok','platform']
    modelId: str | None = None


@router.put('/preferences')
def preferences(payload: Preferences, user: User = Depends(get_current_user), session: Session = Depends(get_db)):
    if payload.mode == 'platform' and (payload.modelId != service.MODEL_ID or not service.enabled()):
        return error_response(service.BillingError('PLATFORM_UNAVAILABLE','该积分模型暂不可用',503))
    row = account(session,user.id)
    row.mode, row.model_id = payload.mode, payload.modelId if payload.mode == 'platform' else None
    session.commit()
    return {'status':'ok','mode':row.mode,'modelId':row.model_id}
