"""Fail-closed server-only catalog. No model or rate is invented by default."""
import json
from dataclasses import dataclass, field
from decimal import Decimal
from urllib.parse import urlsplit

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class BillingSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="BILLING_", extra="ignore", frozen=True)
    models_json: str = "[]"
    provider_keys_json: str = Field(default="{}", repr=False)
    payments_enabled: bool = False
    notify_base_url: str = ""
    alipay_app_id: str = ""
    alipay_seller_id: str = ""
    alipay_private_key_pem: str = Field(default="", repr=False)
    alipay_public_key_pem: str = ""
    wechat_app_id: str = ""
    wechat_mchid: str = ""
    wechat_serial: str = ""
    wechat_private_key_pem: str = Field(default="", repr=False)
    wechat_public_key_pem: str = ""
    wechat_public_serial: str = ""
    wechat_api_v3_key: str = Field(default="", repr=False)


@dataclass(frozen=True)
class PlatformModel:
    id: str
    provider: str
    display_name: str
    model: str
    base_url: str
    input_price: Decimal
    output_price: Decimal
    max_input_tokens: int
    max_output_tokens: int
    api_key: str = field(repr=False)

    def public(self):
        from .billing_service import cost_micros
        return {"id": self.id, "provider": self.provider, "displayName": self.display_name,
                "inputPricePerMillionYuan": str(self.input_price), "outputPricePerMillionYuan": str(self.output_price),
                "maxInputTokens": self.max_input_tokens, "maxOutputTokens": self.max_output_tokens,
                "reservationMicros": cost_micros(self.max_input_tokens, self.max_output_tokens, self.input_price, self.output_price)}


def platform_models(settings=None) -> dict[str, PlatformModel]:
    settings = settings or BillingSettings()
    result = {}
    try:
        keys = json.loads(settings.provider_keys_json)
        rows = json.loads(settings.models_json, parse_float=Decimal)
        if not isinstance(keys, dict) or not isinstance(rows, list):
            return {}
        for row in rows:
            if not isinstance(row, dict) or any(not isinstance(row.get(key), str) or not row[key].strip() for key in ["id", "provider", "displayName", "model", "baseUrl"]):
                return {}
            input_price, output_price = Decimal(str(row["inputPricePerMillionYuan"])), Decimal(str(row["outputPricePerMillionYuan"]))
            if not input_price.is_finite() or not output_price.is_finite() or min(input_price, output_price) < 0:
                continue
            url = urlsplit(row["baseUrl"])
            key = keys.get(row["provider"])
            if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment or not isinstance(key, str) or not key:
                continue
            limits = [row["maxInputTokens"], row["maxOutputTokens"]]
            if any(type(n) is not int or not 1 <= n <= 1000000 for n in limits):
                continue
            if max(len(str(input_price)), len(str(output_price))) > 64 or input_price * limits[0] + output_price * limits[1] > 100000000:
                continue
            model = PlatformModel(row["id"], row["provider"], row["displayName"], row["model"], row["baseUrl"], input_price, output_price, *limits, key)
            if model.id in result or not 1 <= len(model.id) <= 128:
                return {}
            result[model.id] = model
    except (ValueError, TypeError, KeyError, ArithmeticError):
        return {}
    return result
