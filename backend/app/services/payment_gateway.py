"""Direct merchant payment protocols; credentials never leave the server."""
import base64
import json
import re
import secrets
import time
from datetime import datetime
from decimal import Decimal
from urllib.parse import urlencode

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .billing_config import BillingSettings


class PaymentError(RuntimeError):
    pass


def sign(message: bytes, pem: str) -> str:
    key = serialization.load_pem_private_key(pem.encode(), password=None)
    return base64.b64encode(key.sign(message, padding.PKCS1v15(), hashes.SHA256())).decode()


def verify(message: bytes, signature: str, pem: str) -> None:
    try:
        key = serialization.load_pem_public_key(pem.encode())
        key.verify(base64.b64decode(signature, validate=True), message, padding.PKCS1v15(), hashes.SHA256())
    except Exception:
        raise PaymentError("支付验签失败") from None


def channel_available(channel: str, settings=None) -> bool:
    s = settings or BillingSettings()
    if not s.payments_enabled or not s.notify_base_url.startswith("https://"):
        return False
    if channel == "alipay":
        values = [s.alipay_app_id, s.alipay_seller_id, s.alipay_private_key_pem, s.alipay_public_key_pem]
    elif channel == "wechat":
        values = [s.wechat_app_id, s.wechat_mchid, s.wechat_serial, s.wechat_private_key_pem, s.wechat_public_key_pem, s.wechat_public_serial]
        if len(s.wechat_api_v3_key.encode()) != 32:
            return False
    else:
        return False
    if not all(values):
        return False
    try:
        private = s.alipay_private_key_pem if channel == "alipay" else s.wechat_private_key_pem
        public = s.alipay_public_key_pem if channel == "alipay" else s.wechat_public_key_pem
        serialization.load_pem_private_key(private.encode(), password=None)
        serialization.load_pem_public_key(public.encode())
    except Exception:
        return False
    return True


def alipay_parameters(method: str, business: dict, s: BillingSettings) -> dict:
    params = {"app_id": s.alipay_app_id, "method": method, "format": "JSON", "charset": "utf-8", "sign_type": "RSA2", "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "version": "1.0", "biz_content": json.dumps(business, ensure_ascii=False, separators=(",", ":"))}
    if method == "alipay.trade.page.pay":
        params["notify_url"] = s.notify_base_url.rstrip("/") + "/api/billing/notify/alipay"
    params["sign"] = sign("&".join(f"{k}={v}" for k, v in sorted(params.items())).encode(), s.alipay_private_key_pem)
    return params


def verify_alipay_notify(params: dict, s: BillingSettings) -> dict:
    if params.get("sign_type") != "RSA2":
        raise PaymentError("签名类型无效")
    message = "&".join(f"{k}={v}" for k, v in sorted(params.items()) if k not in {"sign", "sign_type"} and v != "")
    verify(message.encode(), params.get("sign", ""), s.alipay_public_key_pem)
    return params


def wechat_verify(body: bytes, headers, s: BillingSettings) -> None:
    try:
        stamp = headers.get("Wechatpay-Timestamp", "")
        nonce = headers.get("Wechatpay-Nonce", "")
        if abs(int(stamp) - int(time.time())) > 300 or not nonce or headers.get("Wechatpay-Serial") != s.wechat_public_serial:
            raise ValueError()
        verify(stamp.encode() + b"\n" + nonce.encode() + b"\n" + body + b"\n", headers.get("Wechatpay-Signature", ""), s.wechat_public_key_pem)
    except Exception:
        raise PaymentError("微信支付验签失败") from None


def decrypt_wechat_notify(body: bytes, headers, s: BillingSettings) -> dict:
    wechat_verify(body, headers, s)
    try:
        envelope = json.loads(body)
        if envelope.get("event_type") != "TRANSACTION.SUCCESS":
            raise ValueError()
        resource = envelope["resource"]
        if resource["algorithm"] != "AEAD_AES_256_GCM":
            raise ValueError()
        clear = AESGCM(s.wechat_api_v3_key.encode()).decrypt(resource["nonce"].encode(), base64.b64decode(resource["ciphertext"], validate=True), resource.get("associated_data", "").encode())
        return json.loads(clear)
    except Exception:
        raise PaymentError("微信通知解密失败") from None


async def wechat_request(method: str, path: str, payload: dict | None, s: BillingSettings, transport=None) -> dict:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) if payload is not None else ""
    timestamp, nonce = str(int(time.time())), secrets.token_hex(16)
    signature = sign(f"{method}\n{path}\n{timestamp}\n{nonce}\n{body}\n".encode(), s.wechat_private_key_pem)
    auth = f'WECHATPAY2-SHA256-RSA2048 mchid="{s.wechat_mchid}",nonce_str="{nonce}",timestamp="{timestamp}",serial_no="{s.wechat_serial}",signature="{signature}"'
    async with httpx.AsyncClient(timeout=30, transport=transport, follow_redirects=False) as client:
        response = await client.request(method, "https://api.mch.weixin.qq.com" + path, content=body.encode(), headers={"Authorization": auth, "Content-Type": "application/json", "Accept": "application/json", "Wechatpay-Serial": s.wechat_public_serial})
    wechat_verify(response.content, response.headers, s)
    response.raise_for_status()
    return response.json()


async def create_payment(order, s: BillingSettings, transport=None) -> tuple[str | None, str | None]:
    if order.channel == "alipay":
        params = alipay_parameters("alipay.trade.page.pay", {"out_trade_no": order.id, "product_code": "FAST_INSTANT_TRADE_PAY", "total_amount": f"{Decimal(order.amount_fen) / 100:.2f}", "subject": "StudyPilot AI余额充值"}, s)
        return "https://openapi.alipay.com/gateway.do?" + urlencode(params), None
    data = await wechat_request("POST", "/v3/pay/transactions/native", {"appid": s.wechat_app_id, "mchid": s.wechat_mchid, "description": "StudyPilot AI余额充值", "out_trade_no": order.id, "notify_url": s.notify_base_url.rstrip("/") + "/api/billing/notify/wechat", "amount": {"total": order.amount_fen, "currency": "CNY"}}, s, transport)
    code = data.get("code_url")
    if not isinstance(code, str) or not code.startswith("weixin://wxpay/"):
        raise PaymentError("微信未返回有效付款码")
    return None, code


async def query_payment(order, s: BillingSettings, transport=None) -> dict:
    if order.channel == "wechat":
        return await wechat_request("GET", f"/v3/pay/transactions/out-trade-no/{order.id}?mchid={s.wechat_mchid}", None, s, transport)
    params = alipay_parameters("alipay.trade.query", {"out_trade_no": order.id}, s)
    async with httpx.AsyncClient(timeout=30, transport=transport, follow_redirects=False) as client:
        response = await client.post("https://openapi.alipay.com/gateway.do", data=params)
    response.raise_for_status()
    text = response.text
    match = re.search(r'"alipay_trade_query_response"\s*:\s*', text)
    if not match:
        raise PaymentError("支付宝查单响应无效")
    result, end = json.JSONDecoder().raw_decode(text[match.end():])
    envelope = json.loads(text)
    verify(text[match.end():match.end() + end].encode(), envelope.get("sign", ""), s.alipay_public_key_pem)
    if result.get("code") != "10000":
        return {}
    return result
