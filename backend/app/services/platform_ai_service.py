"""Metered OpenAI-compatible text calls. Never estimates a provider's usage."""
import asyncio
import uuid

import httpx
from sqlalchemy.orm import Session

from .billing_config import platform_models
from .billing_service import BillingError, account, cost_micros, finish_call, reserve_call


async def complete(session, user_id, payload: dict, *, request_id: str | None = None, transport=None) -> str:
    from app.models.billing import BillingAccount
    with Session(bind=session.get_bind()) as preference_session:
        preference = preference_session.get(BillingAccount, user_id)
        credits_selected = bool(preference and (preference.model_id or '').startswith('credits:'))
    if credits_selected:
        from .credits_service import complete as credits_complete
        return await credits_complete(session, user_id, payload, request_id=request_id, transport=transport)
    # Billing commits must never commit or roll back a caller's pending plan,
    # answer or message. Production DB connections are acquired independently.
    with Session(bind=session.get_bind(), expire_on_commit=False) as ledger_session:
        return await _complete(ledger_session, user_id, payload, request_id=request_id, transport=transport)


async def _complete(session, user_id, payload: dict, *, request_id=None, transport=None) -> str:
    row = account(session, user_id)
    model = platform_models().get(row.model_id)
    if row.mode != "platform" or model is None:
        raise BillingError("PLATFORM_UNAVAILABLE", "请先选择已配置的平台模型", 503)
    messages = payload.get("messages", [])
    # Only text chat is supported. UTF-8 bytes are a conservative input-size gate;
    # settlement also verifies the provider's actual input/output token limits.
    if any(not isinstance(message.get("content"), str) for message in messages):
        raise BillingError("UNSUPPORTED_PLATFORM_CAPABILITY", "平台余额目前仅支持学习助手文本对话，请为此能力使用自带 Key")
    if sum(len(message["content"].encode()) + 32 for message in messages) > model.max_input_tokens:
        raise BillingError("PLATFORM_INPUT_TOO_LARGE", "本次上下文超过模型调用上限，请缩短内容")
    body = {**payload, "model": model.model, "stream": False, "max_tokens": model.max_output_tokens}
    body.pop("stream_options", None)
    call_id = request_id or uuid.uuid4().hex
    reserve_call(session, user_id, model, call_id)
    try:
        async with httpx.AsyncClient(timeout=60, transport=transport, follow_redirects=False) as client:
            response = await client.post(model.base_url, headers={"Authorization": f"Bearer {model.api_key}"}, json=body)
        response.raise_for_status()
        data = response.json()
        usage = data.get("usage") or {}
        input_tokens = usage.get("prompt_tokens", usage.get("input_tokens"))
        output_tokens = usage.get("completion_tokens", usage.get("output_tokens"))
        charge = cost_micros(input_tokens, output_tokens, model.input_price, model.output_price)
        if input_tokens > model.max_input_tokens or output_tokens > model.max_output_tokens:
            raise BillingError("INVALID_USAGE", "上游用量超出模型上限，未扣费")
        content = data["choices"][0]["message"]["content"]
        if not isinstance(content, str) or not content.strip():
            raise BillingError("INVALID_USAGE", "模型响应无有效文本，未扣费")
        if not finish_call(session, call_id, (charge, input_tokens, output_tokens)):
            raise BillingError("CALL_EXPIRED", "本次调用已超时释放，请重新发起")
        return content
    except BaseException as error:
        # Cancellation also releases funds. No retry: a timed-out upstream may
        # have executed the request already. Crashed workers expire in 10 min.
        session.rollback()
        finish_call(session, call_id, None)
        if isinstance(error, (BillingError, asyncio.CancelledError, GeneratorExit)):
            raise
        raise BillingError("PLATFORM_AI_FAILED", "平台模型调用失败，预留余额已释放，请稍后重试", 502) from None
