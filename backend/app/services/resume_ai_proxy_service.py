"""Proxy magic-resume AI endpoints using personal-center credentials.

The resume editor (public/resume-site) posts to /api/grammar, /api/polish,
/api/ai-test and /api/models with a client-side connection object. StudyPilot
keeps the real API key encrypted in ApiConfig; the frontend only writes a
sentinel key into ai-config-storage so the UI shows "configured". These
handlers ignore the client apiKey and always resolve the verified personal
center credential in process memory.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.services.ai_proxy import (
    CredentialUnavailableError,
    ResolvedCredential,
    build_outbound_headers,
    resolve_credential,
)
from app.services.api_config_service import (
    NoVerifiedApiConfigError,
    list_remote_models,
    normalize_base_url,
)
from app.services.planner_service import _extract_assistant_text

GRAMMAR_PROMPT = (
    "你是一个专业的中文简历校对助手。你的任务是**仅**找出简历中的**错别字**和**标点符号错误**。\n"
    "只返回 JSON：{\"errors\":[{\"context\",\"text\",\"suggestion\",\"reason\",\"type\"}]}。"
    "若无错误则 errors 为空数组。禁止润色建议；忽略中英文标点混用与空格问题。"
)

POLISH_PROMPT = (
    "你是一个专业的简历优化助手。请优化以下 Markdown 文本，使其更专业。\n"
    "只输出润色后的正文，禁止前言/说明/总结；严格保留原有 Markdown 结构。"
)


class ResumeAiProxyError(RuntimeError):
    """Safe, credential-free failure for resume AI proxy routes."""

    def __init__(self, code: str, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _resolve(session: Session, user_id) -> ResolvedCredential:
    try:
        return resolve_credential(session, user_id)
    except NoVerifiedApiConfigError as error:
        raise ResumeAiProxyError(
            "NO_API_KEY",
            "请先在个人中心配置并验证 API",
            status=400,
        ) from error
    except CredentialUnavailableError as error:
        raise ResumeAiProxyError(
            "CRED_UNAVAILABLE",
            "凭证暂不可用，请稍后重试",
            status=502,
        ) from error


def _chat_payload(
    credential: ResolvedCredential,
    *,
    system: str,
    user_text: str,
    stream: bool,
    json_mode: bool,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": credential.model_type,
        "stream": stream,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_text},
        ],
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    return payload


async def test_connection(session: Session, user_id) -> dict[str, bool]:
    credential = _resolve(session, user_id)
    headers = {**build_outbound_headers(credential), "Content-Type": "application/json"}
    payload = _chat_payload(
        credential,
        system="Reply with exactly OK.",
        user_text="Test this connection.",
        stream=False,
        json_mode=False,
    )
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(credential.base_url, headers=headers, json=payload)
            response.raise_for_status()
            text = _extract_assistant_text(response.json()).strip()
    except httpx.HTTPError as error:
        raise ResumeAiProxyError("upstreamError", "AI 连接检测失败", status=502) from error
    if not text.upper().startswith("OK"):
        raise ResumeAiProxyError("invalidOutput", "AI 连接检测返回异常", status=502)
    return {"ok": True}


def _parse_grammar_errors(raw: str) -> list:
    cleaned = (raw or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].lstrip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise ResumeAiProxyError("invalidOutput", "AI 语法检查返回无法解析", status=502)
        try:
            parsed = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as error:
            raise ResumeAiProxyError(
                "invalidOutput", "AI 语法检查返回无法解析", status=502
            ) from error
    if not isinstance(parsed, dict) or not isinstance(parsed.get("errors"), list):
        raise ResumeAiProxyError("invalidOutput", "AI 语法检查返回结构异常", status=502)
    return parsed["errors"]


async def check_grammar(session: Session, user_id, content: str) -> dict[str, Any]:
    if not isinstance(content, str) or not content.strip():
        raise ResumeAiProxyError("invalidRequest", "内容不能为空", status=400)
    credential = _resolve(session, user_id)
    headers = {**build_outbound_headers(credential), "Content-Type": "application/json"}
    payload = _chat_payload(
        credential,
        system=GRAMMAR_PROMPT,
        user_text=content,
        stream=False,
        json_mode=True,
    )
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(credential.base_url, headers=headers, json=payload)
            response.raise_for_status()
            text = _extract_assistant_text(response.json())
    except httpx.HTTPError as error:
        raise ResumeAiProxyError("upstreamError", "AI 语法检查失败", status=502) from error
    errors = _parse_grammar_errors(text)
    return {
        "choices": [
            {"message": {"content": json.dumps({"errors": errors}, ensure_ascii=False)}}
        ]
    }


def _delta_from_sse_data(data: str) -> str:
    if data.strip() == "[DONE]":
        return ""
    try:
        payload = json.loads(data)
    except json.JSONDecodeError:
        return ""
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    delta = first.get("delta")
    if isinstance(delta, dict) and isinstance(delta.get("content"), str):
        return delta["content"]
    message = first.get("message")
    if isinstance(message, dict) and isinstance(message.get("content"), str):
        return message["content"]
    if isinstance(first.get("text"), str):
        return first["text"]
    return ""


async def iter_polish_chunks(
    session: Session, user_id, content: str, custom_instructions: str = ""
) -> AsyncIterator[str]:
    if not isinstance(content, str) or not content.strip():
        raise ResumeAiProxyError("invalidRequest", "内容不能为空", status=400)
    credential = _resolve(session, user_id)
    system = POLISH_PROMPT
    extra = (custom_instructions or "").strip()
    if extra:
        system = f"{system}\n\n用户额外要求：\n{extra}"
    headers = {**build_outbound_headers(credential), "Content-Type": "application/json"}
    payload = _chat_payload(
        credential,
        system=system,
        user_text=content,
        stream=True,
        json_mode=False,
    )
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                credential.base_url,
                headers=headers,
                json=payload,
            ) as response:
                if response.status_code >= 400:
                    raise ResumeAiProxyError("upstreamError", "AI 润色失败", status=502)
                buffer = ""
                async for chunk in response.aiter_text():
                    buffer += chunk
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        delta = _delta_from_sse_data(data)
                        if delta:
                            yield delta
    except ResumeAiProxyError:
        raise
    except httpx.HTTPError as error:
        raise ResumeAiProxyError("upstreamError", "AI 润色失败", status=502) from error


async def list_models_for_resume(session: Session, user_id) -> dict[str, Any]:
    credential = _resolve(session, user_id)
    root = normalize_base_url(credential.base_url.replace("/chat/completions", ""))
    try:
        models = await list_remote_models(credential.api_key, root)
    except Exception as error:
        raise ResumeAiProxyError(
            "MODELS_FETCH_FAILED", "无法获取可用模型列表", status=502
        ) from error
    return {
        "models": [m.get("id") for m in models if isinstance(m, dict) and m.get("id")]
    }