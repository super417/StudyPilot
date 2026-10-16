"""Backend and frontend DIVERGENCE_THRESHOLD must stay equal."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from app.services.divergence import DIVERGENCE_THRESHOLD


def _repo_root() -> Path:
    # tests/ → backend/ → study-pilot/ (repo root for this project)
    return Path(__file__).resolve().parents[2]


def _frontend_threshold(source: str) -> int:
    match = re.search(
        r"(?:export\s+)?const\s+DIVERGENCE_THRESHOLD\s*=\s*(\d+)\s*;?",
        source,
    )
    if match is None:
        raise AssertionError(
            "PhaseRings.tsx 中找不到 DIVERGENCE_THRESHOLD 赋值"
        )
    return int(match.group(1))


class DivergenceThresholdParityTests(unittest.TestCase):
    def test_backend_matches_frontend_phase_rings_constant(self) -> None:
        path = (
            _repo_root()
            / "frontend"
            / "src"
            / "components"
            / "PhaseRings.tsx"
        )
        self.assertTrue(path.is_file(), f"找不到前端常量文件: {path}")
        frontend_value = _frontend_threshold(path.read_text(encoding="utf-8"))
        self.assertEqual(
            DIVERGENCE_THRESHOLD,
            frontend_value,
            f"背离阈值不一致：后端 {DIVERGENCE_THRESHOLD} / 前端 {frontend_value}",
        )

    def test_parity_assertion_fails_when_values_differ(self) -> None:
        """Self-check: the failure message must name both sides."""
        backend_value = 30
        frontend_value = 31
        with self.assertRaises(AssertionError) as ctx:
            self.assertEqual(
                backend_value,
                frontend_value,
                f"背离阈值不一致：后端 {backend_value} / 前端 {frontend_value}",
            )
        message = str(ctx.exception)
        self.assertIn("后端 30", message)
        self.assertIn("前端 31", message)


if __name__ == "__main__":
    unittest.main()
