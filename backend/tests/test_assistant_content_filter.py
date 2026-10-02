"""Assistant stream must expose final answers only — never thinking/reasoning."""

from __future__ import annotations

import unittest

from app.services.assistant_service import (
    extract_assistant_content_delta,
    extract_assistant_message_content,
)


class AssistantContentExtractionTests(unittest.TestCase):
    def test_stream_delta_ignores_reasoning_content(self) -> None:
        choice = {
            "delta": {
                "reasoning_content": "目标：回答用户问题……身份：StudyPilot……",
                "content": "",
            }
        }
        self.assertEqual(extract_assistant_content_delta(choice), "")

    def test_stream_delta_returns_final_content_only(self) -> None:
        choice = {
            "delta": {
                "reasoning_content": "先想一下怎么答……",
                "content": "我可以帮你做复习规划与错题复盘。",
            }
        }
        self.assertEqual(
            extract_assistant_content_delta(choice),
            "我可以帮你做复习规划与错题复盘。",
        )

    def test_non_stream_message_ignores_reasoning_fallback(self) -> None:
        choice = {
            "message": {
                "reasoning_content": "内部思考过程不要给用户看",
                "content": "",
            }
        }
        self.assertEqual(extract_assistant_message_content(choice), "")

    def test_non_stream_strips_think_wrappers(self) -> None:
        choice = {
            "message": {
                "content": "<think>草稿推理</think>\n最终答案：先做错题复盘。",
            }
        }
        self.assertEqual(
            extract_assistant_message_content(choice),
            "最终答案：先做错题复盘。",
        )


if __name__ == "__main__":
    unittest.main()
