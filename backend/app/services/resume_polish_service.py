"""Constrained wording pass for evidence-backed resume descriptions."""

import json
import re
import uuid

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session

from app.services.ai_proxy import build_outbound_headers, resolve_credential
from app.services.planner_service import _extract_assistant_text


class ResumeSkill(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    skill: str = Field(min_length=1)
    phase: str | None
    evidenceCount: int = Field(ge=0)
    masteryPercent: int | None = Field(ge=0, le=100)
    description: str = Field(min_length=1, max_length=300)


class ResumePolishPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    skills: list[ResumeSkill] = Field(max_length=30)


PROTECTED_FIELDS = ("skill", "phase", "evidenceCount", "masteryPercent")


def validate_polished_payload(source: dict, candidate: object) -> dict:
    """Validate JSON structure, order and immutable data before any response escapes."""
    try:
        original = ResumePolishPayload.model_validate(source)
        polished = ResumePolishPayload.model_validate(candidate)
    except ValidationError as error:
        raise ValueError("模型返回的简历结构无效") from error
    if len(original.skills) != len(polished.skills):
        raise ValueError("模型更改了能力数量")
    for before, after in zip(original.skills, polished.skills, strict=True):
        for field in PROTECTED_FIELDS:
            if getattr(before, field) != getattr(after, field):
                raise ValueError(f"模型更改了受保护字段：{field}")
            assert getattr(before, field) == getattr(after, field)
        if re.search(r"\d", after.description):
            raise ValueError("润色描述含新增数字")
    return polished.model_dump()


async def polish_resume_skills(session: Session, user_id: uuid.UUID, source: dict) -> dict:
    """Ask the configured model for descriptions only, then reject data drift."""
    validated_source = ResumePolishPayload.model_validate(source).model_dump()
    credential = resolve_credential(session, user_id)
    prompt = (
        "只润色 skills 中每项的 description，保持简洁、客观。"
        "仅依据原始 description 措辞，不添加项目、经历、成果、数字或未给出的事实。"
        "skill、phase、evidenceCount、masteryPercent 四字段及数组顺序必须原样保留。"
        "只返回符合给定 JSON Schema 的 JSON 对象，不加 Markdown。"
    )
    outbound = {
        "model": credential.model_type,
        "stream": False,
        "messages": [
            {"role": "system", "content": prompt + "\nJSON Schema: " + json.dumps(ResumePolishPayload.model_json_schema(), ensure_ascii=False)},
            {"role": "user", "content": json.dumps(validated_source, ensure_ascii=False)},
        ],
    }
    headers = {**build_outbound_headers(credential), "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(credential.base_url, headers=headers, json=outbound)
            response.raise_for_status()
            text = _extract_assistant_text(response.json()).strip()
    except (httpx.HTTPError, ValueError) as error:
        raise RuntimeError("模型润色暂不可用") from error
    try:
        candidate = json.loads(text)
    except json.JSONDecodeError as error:
        raise ValueError("模型未返回有效 JSON") from error
    return validate_polished_payload(validated_source, candidate)
