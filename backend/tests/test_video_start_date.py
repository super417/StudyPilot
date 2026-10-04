import asyncio
import json
import os
import unittest
from datetime import date, datetime

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.models.base import Base
from app.models.entities import DailyTask, Phase, Plan, User
from app.services.assistant_service import stream_assistant_reply
from app.services.video_draft_store import video_draft_store
from app.services.video_link import parse_start_date, suggest_start


class ParseStartDateTests(unittest.TestCase):
    def test_relative_and_absolute_days(self) -> None:
        today = date(2026, 10, 4)
        self.assertEqual(parse_start_date("明天", today), date(2026, 10, 5))
        self.assertEqual(parse_start_date("今天", today), today)
        self.assertEqual(parse_start_date("10月8日", today), date(2026, 10, 8))
        self.assertEqual(parse_start_date("10月8日", date(2026, 10, 20)), date(2027, 10, 8))
        self.assertIsNone(parse_start_date("随便", today))

    def test_evening_suggests_tomorrow(self) -> None:
        self.assertEqual(suggest_start(datetime(2026, 10, 4, 21, 0)), date(2026, 10, 5))
        self.assertEqual(suggest_start(datetime(2026, 10, 4, 19, 0)), date(2026, 10, 4))


class ConfirmBeforeWriteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._environment = {
            name: os.environ.get(name) for name in ("DATABASE_URL", "DB_PASSWORD")
        }
        os.environ["DATABASE_URL"] = "sqlite:///:memory:"
        os.environ["DB_PASSWORD"] = "temporary-test-password"
        get_settings.cache_clear()
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.session_factory = sessionmaker(
            bind=cls.engine, class_=Session, expire_on_commit=False
        )

    @classmethod
    def tearDownClass(cls) -> None:
        cls.engine.dispose()
        get_settings.cache_clear()
        for name, value in cls._environment.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def setUp(self) -> None:
        Base.metadata.create_all(self.engine)
        self.session = self.session_factory()
        video_draft_store.clear()
        user = User(username=f"u-{os.urandom(3).hex()}", password_hash="x" * 8)
        self.session.add(user)
        self.session.flush()
        self.user = user
        start = date(2026, 10, 1)
        plan = Plan(
            user_id=user.id,
            goal_name="数学二",
            start_date=start,
            goal_date=date(2026, 12, 31),
            current_level="基础",
            daily_minutes=120,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        self.session.add(
            Phase(
                plan_id=plan.id,
                phase_index=1,
                name="基础",
                start_date=start,
                end_date=date(2026, 12, 31),
                is_current=True,
            )
        )
        self.session.commit()

    def tearDown(self) -> None:
        video_draft_store.clear()
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def _material(self, url: str) -> dict:
        return {
            "url": url,
            "title": "高数基础",
            "source": "",
            "summary": "",
            "body": "",
            "sections": [
                {"label": "P1", "url": url, "duration": 3600},
            ],
        }

    def _text(self, message: str, now: datetime) -> str:
        url = "https://www.bilibili.com/video/BV1mr4y1K7Lb"

        async def fetcher(found: str) -> dict:
            return self._material(found)

        async def run() -> str:
            parts: list[str] = []
            async for frame in stream_assistant_reply(
                self.session,
                self.user.id,
                message,
                None,
                video_fetcher=fetcher,
                now=now,
            ):
                if "event: token" not in frame:
                    continue
                payload = json.loads(frame.split("data: ", 1)[1])
                parts.append(payload.get("delta") or "")
            return "".join(parts)

        return asyncio.run(run())

    def _count(self) -> int:
        return self.session.scalar(select(func.count()).select_from(DailyTask)) or 0

    def test_link_does_not_write_until_tomorrow_is_confirmed(self) -> None:
        evening = datetime(2026, 10, 4, 21, 36)
        asked = self._text("https://www.bilibili.com/video/BV1mr4y1K7Lb", evening)
        self.assertEqual(self._count(), 0)
        self.assertIn("建议从 2026-10-05 开始", asked)
        self.assertIn("2026-10-05", asked)
        written = self._text("明天", evening)
        self.assertIn("2026-10-05", written)
        tasks = list(self.session.scalars(select(DailyTask).order_by(DailyTask.task_date)))
        self.assertGreaterEqual(len(tasks), 1)
        self.assertEqual(tasks[0].task_date, date(2026, 10, 5))

    def test_yes_previews_the_suggested_day_before_confirmation(self) -> None:
        morning = datetime(2026, 10, 4, 9, 0)
        self._text("https://www.bilibili.com/video/BV1mr4y1K7Lb", morning)
        self.assertEqual(self._count(), 0)
        preview = self._text("可以", morning)
        self.assertEqual(self._count(), 0)
        self.assertIn("2026-10-04", preview)
        self._text("确认", morning)
        tasks = list(self.session.scalars(select(DailyTask).order_by(DailyTask.task_date)))
        self.assertEqual(tasks[0].task_date, date(2026, 10, 4))
