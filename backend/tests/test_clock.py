import unittest
from datetime import datetime, timedelta, timezone

from app.core.clock import local_today


class ClockTests(unittest.TestCase):
    def test_local_today_matches_china_offset(self) -> None:
        expected = datetime.now(timezone(timedelta(hours=8))).date()
        self.assertEqual(local_today(), expected)
