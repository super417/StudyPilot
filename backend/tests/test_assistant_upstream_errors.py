"""Upstream chat failures become safe, actionable assistant SSE errors."""

import json
import unittest
from contextlib import asynccontextmanager
from unittest.mock import patch

import httpx

from app.services import assistant_service
from app.services.ai_proxy import ResolvedCredential


class _Session:
    def get(self, *_args):
        return None


class UpstreamChatErrorTests(unittest.IsolatedAsyncioTestCase):
    async def test_streaming_402_is_not_retried_or_exposed(self) -> None:
        credential = ResolvedCredential(
            api_key="sk-secret-test-key",
            model_type="test-model",
            base_url="https://api.example.test/v1/chat/completions",
        )

        class FakeClient:
            def __init__(self, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            @asynccontextmanager
            async def stream(self, method, url, headers, json):
                yield httpx.Response(
                    402,
                    json={"error": {
                        "type": "insufficient_balance_error",
                        "message": "sk-secret-test-key upstream detail",
                    }},
                    request=httpx.Request(method, url),
                )

            async def post(self, *_args, **_kwargs):
                raise AssertionError("402 must not trigger a second billable request")

        with patch.object(assistant_service.httpx, "AsyncClient", FakeClient):
            with self.assertRaises(assistant_service.UpstreamChatError) as caught:
                async with assistant_service.openai_compatible_chat_stream(
                    credential, {"model": "test-model", "messages": []}
                ):
                    pass

        self.assertEqual(caught.exception.status, 402)
        self.assertEqual(caught.exception.upstream_code, "insufficient_balance_error")
        self.assertNotIn("sk-secret-test-key", str(caught.exception))

    async def test_upstream_status_maps_to_sse_error(self) -> None:
        credential = ResolvedCredential(
            api_key="sk-secret-test-key",
            model_type="test-model",
            base_url="https://api.example.test/v1/chat/completions",
        )
        cases = (
            (402, "AI_INSUFFICIENT_BALANCE", "API 账户余额不足，请充值或更换 Key 后重试"),
            (401, "AI_AUTH_FAILED", "API Key 无效或已失效，请到个人中心重新配置"),
            (403, "AI_AUTH_FAILED", "API Key 无效或已失效，请到个人中心重新配置"),
            (429, "AI_RATE_LIMITED", "API 调用过于频繁，请稍后重试"),
        )
        for status, expected_code, expected_message in cases:
            with self.subTest(status=status):
                class FakeClient:
                    def __init__(self, **_kwargs):
                        pass

                    async def __aenter__(self):
                        return self

                    async def __aexit__(self, *_args):
                        return None

                    @asynccontextmanager
                    async def stream(self, method, url, headers, json):
                        yield httpx.Response(
                            400,
                            json={"error": {"type": "stream_not_supported"}},
                            request=httpx.Request(method, url),
                        )

                    async def post(self, url, headers, json):
                        return httpx.Response(
                            status,
                            json={"error": {
                                "type": "insufficient_balance_error",
                                "message": "sk-secret-test-key upstream detail",
                            }},
                            request=httpx.Request("POST", url),
                        )

                with (
                    patch.object(assistant_service, "has_verified_api_config", return_value=True),
                    patch.object(assistant_service, "resolve_credential", return_value=credential),
                    patch.object(assistant_service, "_list_user_doc_ids", return_value=[]),
                    patch.object(assistant_service, "_course_candidates_note", return_value=None),
                    patch.object(assistant_service.document_service, "build_context", return_value=("", [])),
                    patch.object(assistant_service.httpx, "AsyncClient", FakeClient),
                ):
                    frames = [frame async for frame in assistant_service._stream_chat_reply(
                        _Session(), "test-user", "高数怎么复习", None,
                    )]

                self.assertEqual(len(frames), 1)
                self.assertTrue(frames[0].startswith("event: error\n"))
                payload = json.loads(frames[0].split("data: ", 1)[1])
                self.assertEqual(payload, {"code": expected_code, "message": expected_message})
                self.assertNotIn("sk-secret-test-key", frames[0])


if __name__ == "__main__":
    unittest.main()
