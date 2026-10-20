"""前后端 STAR_THRESHOLDS 必须是同一组数。"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from app.services.journey_service import STAR_THRESHOLDS


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _frontend_thresholds(source: str) -> tuple[int, int, int]:
    match = re.search(
        r"export const STAR_THRESHOLDS = \[(\d+),\s*(\d+),\s*(\d+)\]",
        source,
    )
    if match is None:
        raise AssertionError("frontend/src/journey/stars.ts 中找不到 STAR_THRESHOLDS")
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


class JourneyThresholdParityTests(unittest.TestCase):
    def test_backend_matches_frontend_star_thresholds(self) -> None:
        path = _repo_root() / "frontend" / "src" / "journey" / "stars.ts"
        self.assertTrue(path.is_file(), f"找不到前端常量文件: {path}")
        frontend = _frontend_thresholds(path.read_text(encoding="utf-8"))
        self.assertEqual(
            STAR_THRESHOLDS,
            frontend,
            f"星级阈值不一致：后端 {STAR_THRESHOLDS} / 前端 {frontend}",
        )


if __name__ == "__main__":
    unittest.main()
