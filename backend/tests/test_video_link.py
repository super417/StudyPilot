import os
import unittest
from datetime import date, timedelta

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.models.base import Base
from app.models.entities import DailyTask, Phase, Plan, User
from app.services.video_link import (
    extract_bvid,
    extract_url,
    material_from_html,
    merge_into_daily_plan,
    normalize_view,
    wants_to_adopt,
)


class VideoLinkTests(unittest.TestCase):
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

    def tearDown(self) -> None:
        self.session.close()
        Base.metadata.drop_all(self.engine)

    def test_extracts_bvid_and_does_not_treat_the_link_as_a_yes(self) -> None:
        text = "https://www.bilibili.com/video/BV1mr4y1K7Lb/?spm_id_from=333 这学习视频可以吗？"
        clean = "https://www.bilibili.com/video/BV1mr4y1K7Lb"
        self.assertEqual(extract_bvid(text), "BV1mr4y1K7Lb")
        self.assertEqual(extract_url(text), clean)
        glued = "https://www.bilibili.com/video/BV1mr4y1K7Lb/?spm_id_from=333数二基础阶段学这个视频如何？"
        self.assertEqual(extract_url(glued), clean)
        self.assertFalse(wants_to_adopt(text))
        self.assertFalse(wants_to_adopt("https://example.com/course 这个适合吗"))
        self.assertTrue(wants_to_adopt("按这个来学"))
        self.assertTrue(wants_to_adopt("好的"))

    def test_bilibili_url_drops_tracking_and_glued_text(self) -> None:
        link = (
            "https://www.bilibili.com/video/BV1mr4y1K7Lb/"
            "?spm_id_from=333.1387.favlist.content.click"
            "&vd_source=cda7d1d06b24a89b41ce2b851321dfe8"
        )
        clean = "https://www.bilibili.com/video/BV1mr4y1K7Lb"
        self.assertEqual(extract_url(link + "P1开始"), clean)
        self.assertEqual(extract_url(link + "from今天"), clean)
        self.assertEqual(extract_url(link + "abc"), clean)
        self.assertEqual(extract_url(link + " 请排进计划"), clean)
        self.assertEqual(extract_url(link + "，然后排一下"), clean)
        found = extract_url(link)
        self.assertEqual(found, clean)
        assert found is not None
        self.assertNotIn("spm_id_from", found)
        self.assertNotIn("vd_source", found)

    def test_generic_url_rejects_glued_ascii(self) -> None:
        url = "https://example.com/course"
        self.assertEqual(extract_url(url), url)
        self.assertEqual(extract_url(url + " 请排进计划"), url)
        self.assertEqual(extract_url(url + "请排进计划"), url)
        self.assertEqual(extract_url(url + "，然后排一下"), url)
        self.assertIsNone(extract_url(url + "abc"))
        self.assertIsNone(extract_url(url + "P1开始"))
        self.assertIsNone(extract_url(url + "from今天"))

    def test_normalize_keeps_title_and_parts(self) -> None:
        video = normalize_view(
            {
                "code": 0,
                "data": {
                    "title": "高数基础",
                    "desc": "讲极限",
                    "tname": "考研",
                    "owner": {"name": "某老师"},
                    "pages": [
                        {"page": 1, "part": "极限", "duration": 1800},
                        {"page": 2, "part": "导数", "duration": 1800},
                    ],
                },
            },
            "BV1mr4y1K7Lb",
        )
        self.assertIsNotNone(video)
        assert video is not None
        self.assertEqual(video["title"], "高数基础")
        self.assertEqual([item["label"] for item in video["sections"]], ["P1 极限", "P2 导数"])

    def test_html_keeps_title_and_headings(self) -> None:
        material = material_from_html(
            "https://example.com/note",
            "<html><head><title>极限笔记</title>"
            '<meta name="description" content="从定义讲起"></head>'
            "<body><h1>定义</h1><p>函数极限</p><h2>例题</h2></body></html>",
        )
        self.assertEqual(material["title"], "极限笔记")
        self.assertEqual([item["label"] for item in material["sections"]], ["定义", "例题"])
        self.assertIn("函数极限", material["body"])

    def test_merge_puts_parts_on_upcoming_days(self) -> None:
        user = User(username=f"u-{os.urandom(3).hex()}", password_hash="x" * 8)
        self.session.add(user)
        self.session.flush()
        today = date.today()
        plan = Plan(
            user_id=user.id,
            goal_name="数学二",
            start_date=today,
            goal_date=today + timedelta(days=10),
            current_level="基础",
            daily_minutes=40,
            total_phases=2,
        )
        self.session.add(plan)
        self.session.flush()
        phase = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="基础",
            start_date=today,
            end_date=today + timedelta(days=2),
            is_current=True,
        )
        self.session.add(phase)
        self.session.flush()
        for offset in range(2):
            self.session.add(
                DailyTask(
                    plan_id=plan.id,
                    phase_id=phase.id,
                    task_date=today + timedelta(days=offset),
                    week_label="W40",
                    description="原任务",
                    status="pending",
                )
            )
        self.session.commit()
        video = {
            "url": "https://www.bilibili.com/video/BV1mr4y1K7Lb",
            "title": "高数基础",
            "source": "某老师",
            "summary": "",
            "body": "",
            "sections": [
                {"label": "P1 极限", "url": "https://www.bilibili.com/video/BV1mr4y1K7Lb", "duration": 3600},
                {"label": "P2 导数", "url": "https://www.bilibili.com/video/BV1mr4y1K7Lb?p=2", "duration": 3600},
            ],
        }
        reply = merge_into_daily_plan(self.session, user.id, video)
        tasks = list(self.session.scalars(select(DailyTask).order_by(DailyTask.task_date)))
        self.assertIn("P1 极限", tasks[0].description)
        self.assertIn("P2 导数", tasks[1].description)
        self.assertIn("原任务", tasks[0].description)
        self.assertTrue(tasks[0].resource_url.endswith("BV1mr4y1K7Lb"))
        self.assertIn("p=2", tasks[1].resource_url)
        self.assertIn(today.isoformat(), reply)
        again = merge_into_daily_plan(self.session, user.id, video)
        self.assertIn("已经在每天的任务里", again)
        tasks = list(self.session.scalars(select(DailyTask).order_by(DailyTask.task_date)))
        self.assertEqual(tasks[0].description.count("按《高数基础》"), 1)
