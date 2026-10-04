import os
import unittest
from datetime import date, timedelta

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.models.base import Base
from app.models.entities import DailyTask, Phase, Plan, User
from app.services import video_link
from app.services.video_link import (
    _pack,
    extract_bvid,
    extract_url,
    material_from_html,
    merge_into_daily_plan,
    normalize_view,
    url_is_glued,
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
        self.assertFalse(wants_to_adopt("要不要按这个排？"))
        self.assertFalse(wants_to_adopt("先不要按这个排吧"))

    def test_extracts_all_bvids_without_spaces(self) -> None:
        self.assertEqual(
            video_link.extract_urls("408数据结构要BV1b7411N798还是BV1SiDYBeET5"),
            [
                "https://www.bilibili.com/video/BV1b7411N798",
                "https://www.bilibili.com/video/BV1SiDYBeET5",
            ],
        )

    def test_extracts_mixed_links_in_order_without_duplicates(self) -> None:
        self.assertEqual(
            video_link.extract_urls(
                "https://example.com/course，"
                "https://www.bilibili.com/video/BV1b7411N798/?spm_id_from=333 "
                "还是BV1SiDYBeET5？BV1b7411N798 "
                "https://example.org/notes."
            ),
            [
                "https://example.com/course",
                "https://www.bilibili.com/video/BV1b7411N798",
                "https://www.bilibili.com/video/BV1SiDYBeET5",
                "https://example.org/notes",
            ],
        )

    def test_extracts_only_unambiguous_addresses(self) -> None:
        self.assertEqual(video_link.extract_urls("没有链接"), [])
        self.assertEqual(
            video_link.extract_urls(
                'https://example.com/course"abc 和 https://example.org/notes'
            ),
            ["https://example.org/notes"],
        )
        self.assertEqual(
            video_link.extract_urls("https://example.com/BV1b7411N798"),
            ["https://example.com/BV1b7411N798"],
        )
        self.assertEqual(video_link.extract_urls("https://["), [])

    def test_extracts_urls_separated_by_ascii_punctuation(self) -> None:
        self.assertEqual(
            video_link.extract_urls(
                "https://example.com/a,https://example.org/b;https://example.net/c"
            ),
            ["https://example.com/a", "https://example.org/b", "https://example.net/c"],
        )

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

    def test_generic_url_is_taken_as_written(self) -> None:
        """A non-Bilibili address is never trimmed, and its end is never guessed."""
        url = "https://example.com/course"
        self.assertEqual(extract_url(url), url)
        self.assertEqual(extract_url(url + " 请排进计划"), url)
        self.assertEqual(extract_url(url + "请排进计划"), url)
        self.assertEqual(extract_url(url + "，然后排一下"), url)
        # ASCII glued straight on: the boundary is undecidable, so the address
        # stays whole and a fetch failure gets reported instead of a wrong
        # address being invented.
        self.assertEqual(extract_url(url + "abc"), url + "abc")
        self.assertEqual(extract_url(url + "P1开始"), url + "P1")

    def test_address_ending_in_letters_and_digits_is_not_discarded(self) -> None:
        """Regression: these used to be dropped as "glued text"."""
        for link in (
            "https://example.com/lesson1",
            "https://exam8.com/p12",
            "https://open.163.com/course/XYZ123",
        ):
            self.assertEqual(extract_url(link), link)
            self.assertEqual(extract_url(link + " 帮我排一下"), link)
            self.assertEqual(extract_url(link + "，然后排一下"), link)
            self.assertFalse(url_is_glued(link + " 帮我排一下"))

    def test_glued_detection_skips_what_a_bv_id_pins_down(self) -> None:
        self.assertFalse(
            url_is_glued(
                "https://www.bilibili.com/video/BV1mr4y1K7Lb/?spm_id_from=333数二基础"
            )
        )
        self.assertFalse(url_is_glued("https://example.com/courseabc"))
        self.assertFalse(url_is_glued("https://example.com/course请排"))
        self.assertFalse(url_is_glued("帮我看看 https://example.com/course"))
        self.assertFalse(url_is_glued("没有链接"))
        # Only when ASCII runs into the address with no separator at all.
        self.assertTrue(url_is_glued('https://example.com/course"abc'))
        self.assertIsNone(extract_url('https://example.com/course"abc'))

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
        reply = merge_into_daily_plan(self.session, user.id, video, today)
        tasks = list(self.session.scalars(select(DailyTask).order_by(DailyTask.task_date)))
        self.assertEqual(
            [task.task_date for task in tasks],
            [today + timedelta(days=offset) for offset in range(4)],
        )
        self.assertIn("P1 极限（1/2）", tasks[0].description)
        self.assertIn("P1 极限（2/2）", tasks[1].description)
        self.assertIn("P2 导数（1/2）", tasks[2].description)
        self.assertIn("原任务", tasks[0].description)
        self.assertTrue(tasks[0].resource_url.endswith("BV1mr4y1K7Lb"))
        self.assertIn("p=2", tasks[2].resource_url)
        self.assertIn(today.isoformat(), reply)
        again = merge_into_daily_plan(self.session, user.id, video, today)
        tasks = list(self.session.scalars(select(DailyTask).order_by(DailyTask.task_date)))
        self.assertEqual(tasks[0].description.count("按《高数基础》"), 1)
        self.assertIn(today.isoformat(), again)

    def test_pack_uses_consecutive_days_not_sparse_rows(self) -> None:
        budget = 120 * 60
        short = _pack(
            [
                {"label": "A", "url": "https://example.com/a", "duration": 1200},
                {"label": "B", "url": "https://example.com/b", "duration": 600},
            ],
            120,
        )
        self.assertEqual(len(short), 1)
        self.assertLessEqual(sum(piece["seconds"] for piece in short[0]), budget)

        user = User(username=f"u-{os.urandom(3).hex()}", password_hash="x" * 8)
        self.session.add(user)
        self.session.flush()
        start = date(2026, 10, 4)
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
        phase = Phase(
            plan_id=plan.id,
            phase_index=1,
            name="基础",
            start_date=start,
            end_date=date(2026, 12, 31),
            is_current=True,
        )
        self.session.add(phase)
        self.session.flush()
        for sparse in (date(2026, 10, 20), date(2026, 11, 1)):
            self.session.add(
                DailyTask(
                    plan_id=plan.id,
                    phase_id=phase.id,
                    task_date=sparse,
                    week_label="W01",
                    description="旧任务",
                    status="pending",
                )
            )
        self.session.commit()
        video = {
            "url": "https://www.bilibili.com/video/BV1mr4y1K7Lb",
            "title": "高数基础",
            "source": "",
            "summary": "",
            "body": "",
            "sections": [
                {
                    "label": "P1 26高数基础01",
                    "url": "https://www.bilibili.com/video/BV1mr4y1K7Lb",
                    "duration": 1200,
                },
                {
                    "label": "P2 26高数基础02",
                    "url": "https://www.bilibili.com/video/BV1mr4y1K7Lb?p=2",
                    "duration": 600,
                },
            ],
        }
        merge_into_daily_plan(self.session, user.id, video, start)
        tasks = list(self.session.scalars(select(DailyTask).order_by(DailyTask.task_date)))
        dated = {task.task_date: task for task in tasks}
        self.assertIn(start, dated)
        self.assertNotIn("P1", dated[date(2026, 10, 20)].description)
        self.assertNotIn("P2", dated[date(2026, 11, 1)].description)
        self.assertEqual(dated[date(2026, 10, 20)].description, "旧任务")
        created = [task for task in tasks if task.task_date == start]
        self.assertEqual(len(created), 1)
        self.assertIn("P1 26高数基础01", created[0].description)
        self.assertIn("P2 26高数基础02", created[0].description)

        long = {
            **video,
            "title": "长视频",
            "sections": [
                {
                    "label": "P1 长",
                    "url": "https://www.bilibili.com/video/BV1mr4y1K7Lb",
                    "duration": 20000,
                }
            ],
        }
        merge_into_daily_plan(self.session, user.id, long, start)
        tasks = list(self.session.scalars(select(DailyTask).order_by(DailyTask.task_date)))
        video_days = [task.task_date for task in tasks if "按《长视频》" in task.description]
        self.assertGreaterEqual(len(video_days), 3)
        self.assertEqual(video_days, [start + timedelta(days=i) for i in range(len(video_days))])
        self.assertNotIn(date(2026, 10, 20), video_days)
        self.assertEqual(
            next(task.description for task in tasks if task.task_date == date(2026, 10, 20)),
            "旧任务",
        )
