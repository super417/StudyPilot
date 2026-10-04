"""Read question text from a photo via the user's configured vision model.

The image goes to the same OpenAI-compatible chat/completions endpoint the
assistant uses, as a data-URL ``image_url`` part. GPT-4o-class and Gemini
models read it; a text-only model (e.g. DeepSeek chat) rejects it upstream and
the user gets ``OCR_FAILED``.
"""

from __future__ import annotations

import base64
import uuid

import httpx
from sqlalchemy.orm import Session

from app.services.ai_proxy import build_outbound_headers, resolve_credential
from app.services.planner_service import _extract_assistant_text

MAX_IMAGE_BYTES = 8 * 1024 * 1024
IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
}

_PROMPT = (
    "把图片里的题目原文逐字识别出来，只输出题目文字。"
    "保留题号、选项和换行；数学公式用 LaTeX 写。"
    "不要解题，不要加任何说明。图片里没有文字时只输出空。"
)


class OcrImageError(ValueError):
    code = "VALIDATION"


class OcrFailedError(RuntimeError):
    code = "OCR_FAILED"

    def __init__(
        self, message: str = "识别失败：请确认设置里的模型支持识图（如 GPT-4o、Gemini）"
    ) -> None:
        super().__init__(message)


def validate_image(content_type: str | None, data: bytes) -> str:
    mime = (content_type or "").lower()
    if mime not in IMAGE_TYPES:
        raise OcrImageError("只支持 JPG / PNG / WEBP / GIF / HEIC 图片")
    if not data:
        raise OcrImageError("图片是空的")
    if len(data) > MAX_IMAGE_BYTES:
        raise OcrImageError("图片不能超过 8MB")
    return mime


async def recognize_question(
    session: Session, user_id: uuid.UUID, mime: str, data: bytes
) -> str:
    credential = resolve_credential(session, user_id)
    data_url = f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"
    payload = {
        "model": credential.model_type,
        "stream": False,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _PROMPT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
    }
    headers = {**build_outbound_headers(credential), "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(credential.base_url, headers=headers, json=payload)
    except Exception as error:
        raise OcrFailedError("识别超时或网络异常，请稍后重试") from error
    if response.status_code >= 400:
        raise OcrFailedError()
    try:
        body = response.json()
    except Exception:
        body = response.text
    text = _extract_assistant_text(body).strip()
    if not text:
        raise OcrFailedError("没有从图片里识别出文字，换一张更清晰的试试")
    return text
