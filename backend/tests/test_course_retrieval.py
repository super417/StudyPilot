"""Batch 23: course catalogue is searched with the existing BM25 retriever.

Covers the fragment shape (section granularity, chapter and metadata fallbacks),
chapter URL resolution, skill-gap ranking, and the Top-K shortlist that
route generation hands to the model.
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.core.data_files import load_courses
from app.services import direction_service


def _course(
    course_id: str,
    *,
    name: str,
    institution: str = "机构",
    skills: list[str] | None = None,
    url: str | None = None,
    url_verified: bool = True,
    chapters: list[dict] | None = None,
) -> dict:
    payload = {
        "course_id": course_id,
        "name": name,
        "institution": institution,
        "provider": "平台",
        "url": url if url is not None else f"https://www.icourse163.org/course/{course_id}",
        "url_verified": url_verified,
        "skills": skills or [],
        "collected_at": "2026-10-21",
        "chapters": chapters or [],
    }
    return payload


def _one_course_direction(course: dict) -> dict:
    return {"directions": [{"id": "one", "name": "单课方向", "courses": [course]}]}


def _scope_direction() -> dict:
    """Four verified courses with disjoint vocabulary, used by Top-K tests."""
    return {
        "directions": [
            {
                "id": "scope-demo",
                "name": "检索范围演示",
                "description": "",
                "skills": ["Python", "Excel", "SQL", "Tableau"],
                "courses": [
                    _course(
                        "c-python",
                        name="Python 脚本入门",
                        institution="机构甲",
                        skills=["Python"],
                        chapters=[
                            {
                                "index": 1,
                                "title": "第1章 Python 基础",
                                "sections": ["变量与循环", "函数定义"],
                            }
                        ],
                    ),
                    _course(
                        "c-excel",
                        name="Excel 透视表实战",
                        institution="机构乙",
                        skills=["Excel"],
                        chapters=[
                            {
                                "index": 1,
                                "title": "第1章 Excel 表格",
                                "sections": ["函数与透视", "图表美化"],
                            }
                        ],
                    ),
                    _course(
                        "c-sql",
                        name="SQL 查询精讲",
                        institution="机构丙",
                        skills=["SQL"],
                        chapters=[
                            {
                                "index": 1,
                                "title": "第1章 SQL 查询",
                                "sections": ["联结与聚合", "子查询嵌套"],
                            }
                        ],
                    ),
                    _course(
                        "c-extra",
                        name="Tableau 仪表盘",
                        institution="机构丁",
                        skills=["Tableau"],
                        chapters=[
                            {
                                "index": 1,
                                "title": "第1章 Tableau",
                                "sections": ["仪表盘发布"],
                            }
                        ],
                    ),
                ],
            }
        ]
    }


class CourseFragmentTests(unittest.TestCase):
    def test_real_catalogue_is_split_per_section_with_course_context(self) -> None:
        courses = load_courses()
        direction = courses["directions"][0]
        fragments = direction_service._course_fragments(direction)
        course_count = len([c for c in direction["courses"] if c.get("url_verified")])
        self.assertGreater(len(fragments), course_count)

        first = next(f for f in fragments if f["section"])
        course = next(
            c for c in direction["courses"] if c["course_id"] == first["course_id"]
        )
        self.assertIn(course["name"], first["content"])
        self.assertIn(course["institution"], first["content"])
        self.assertIn(first["section"], first["content"])
        chapter_title = next(
            chapter["title"]
            for chapter in course["chapters"]
            if chapter["index"] == first["chapter_index"]
        )
        self.assertIn(chapter_title, first["content"])
        self.assertEqual(first["chapter_title"], chapter_title)
        for skill in course["skills"]:
            self.assertIn(skill, first["content"])
        self.assertEqual(first["doc_id"], course["course_id"])

    def test_chapter_without_sections_falls_back_to_chapter_fragment(self) -> None:
        courses = _one_course_direction(
            _course(
                "c-nosec",
                name="无节课程",
                chapters=[{"index": 3, "title": "第3章 只有章标题", "sections": []}],
            )
        )
        fragments = direction_service._course_fragments(courses["directions"][0])
        self.assertEqual(len(fragments), 1)
        self.assertEqual(fragments[0]["section"], "")
        self.assertEqual(fragments[0]["chapter_index"], 3)
        self.assertEqual(fragments[0]["chapter_title"], "第3章 只有章标题")
        self.assertIn("第3章 只有章标题", fragments[0]["content"])

    def test_course_without_chapters_falls_back_to_metadata(self) -> None:
        courses = _one_course_direction(
            _course("c-flat", name="无章课程", skills=["技能甲"])
        )
        fragments = direction_service._course_fragments(courses["directions"][0])
        self.assertEqual(len(fragments), 1)
        self.assertIsNone(fragments[0]["chapter_index"])
        self.assertEqual(fragments[0]["chapter_title"], "")
        self.assertEqual(fragments[0]["section"], "")
        self.assertIn("无章课程", fragments[0]["content"])
        self.assertIn("技能甲", fragments[0]["content"])

    def test_unverified_and_urlless_courses_never_produce_fragments(self) -> None:
        courses = _one_course_direction(
            _course("c-bad", name="未核实", url_verified=False, chapters=[{"title": "章", "sections": ["节"]}])
        )
        self.assertEqual(direction_service._course_fragments(courses["directions"][0]), [])

        courses = _one_course_direction(
            _course("c-empty", name="空链接", url="   ", chapters=[{"title": "章", "sections": ["节"]}])
        )
        self.assertEqual(direction_service._course_fragments(courses["directions"][0]), [])


class ChapterUrlFallbackTests(unittest.TestCase):
    """A section hit uses its chapter URL or the course URL — never invented."""

    COURSE_URL = "https://www.icourse163.org/course/PY-1"
    CHAPTER_URL = "https://www.icourse163.org/course/PY-1#/learn/chapter/1"

    def _url_for(self, query: str, chapter_url: object = None, section_urls: dict | None = None) -> str:
        course = _course(
            "c-python",
            name="Python 脚本入门",
            url=self.COURSE_URL,
            chapters=[
                {
                    "index": 1,
                    "title": "第1章 Python 基础",
                    "sections": ["变量与循环", "函数定义"],
                    **({"url": chapter_url} if chapter_url is not None else {}),
                }
            ],
        )
        if section_urls is not None:
            course["section_urls"] = section_urls
        courses = _one_course_direction(course)
        ranked = direction_service.rank_courses("one", query, courses_data=courses)
        self.assertEqual(len(ranked), 1, ranked)
        return ranked[0]["url"]

    def test_missing_chapter_url_returns_course_url(self) -> None:
        self.assertEqual(self._url_for("变量与循环"), self.COURSE_URL)

    def test_matched_section_uses_its_chapter_url(self) -> None:
        self.assertEqual(
            self._url_for("变量与循环", chapter_url=self.CHAPTER_URL),
            self.CHAPTER_URL,
        )

    def test_other_section_in_same_chapter_uses_same_chapter_url(self) -> None:
        self.assertEqual(
            self._url_for("函数定义", chapter_url=self.CHAPTER_URL),
            self.CHAPTER_URL,
        )

    def test_section_uses_its_own_chapter_url(self) -> None:
        second_url = "https://www.icourse163.org/course/PY-1#chapter-2"
        course = _course(
            "c-python",
            name="Python 脚本入门",
            url=self.COURSE_URL,
            chapters=[
                {
                    "index": 1,
                    "title": "第1章 Python 基础",
                    "sections": ["变量与循环"],
                    "url": self.CHAPTER_URL,
                },
                {
                    "index": 2,
                    "title": "第2章 数据处理",
                    "sections": ["缺失值处理"],
                    "url": second_url,
                },
            ],
        )
        ranked = direction_service.rank_courses(
            "one", "缺失值处理", courses_data=_one_course_direction(course)
        )
        self.assertEqual(ranked[0]["section"], "缺失值处理")
        self.assertEqual(ranked[0]["chapterTitle"], "第2章 数据处理")
        self.assertEqual(ranked[0]["sectionTitle"], "缺失值处理")
        self.assertEqual(ranked[0]["url"], second_url)

    def test_chapter_title_without_number_gets_display_index(self) -> None:
        course = _course(
            "c-python",
            name="Python 数据分析",
            chapters=[{"index": 3, "title": "数据清洗", "sections": ["3.2 缺失值处理"]}],
        )
        ranked = direction_service.rank_courses(
            "one", "缺失值处理", courses_data=_one_course_direction(course)
        )
        self.assertEqual(ranked[0]["chapterTitle"], "第 3 章 数据清洗")

    def test_unverified_chapter_url_falls_back_to_course_url(self) -> None:
        for bad in ("https://evil.example/lesson/1", "javascript:alert(1)", "", None):
            with self.subTest(bad=bad):
                self.assertEqual(
                    self._url_for("变量与循环", chapter_url=bad),
                    self.COURSE_URL,
                )

    def test_old_section_urls_are_ignored(self) -> None:
        self.assertEqual(
            self._url_for(
                "变量与循环",
                section_urls={"变量与循环": "https://www.icourse163.org/course/PY-1#guessed"},
            ),
            self.COURSE_URL,
        )

    def test_legacy_chapter_url_field_is_never_read(self) -> None:
        """course.url / chapters[].url / chapters[].chapter_url are all different.

        Only ``chapters[].url`` may answer. The legacy value is a valid,
        allow-listed URL, so reading it by mistake would change the result.
        """
        legacy_url = "https://www.icourse163.org/course/PY-1#/legacy-chapter-url"
        course = _course(
            "c-python",
            name="Python 脚本入门",
            url=self.COURSE_URL,
            chapters=[
                {
                    "index": 1,
                    "title": "第1章 Python 基础",
                    "sections": ["变量与循环"],
                    "url": self.CHAPTER_URL,
                    "chapter_url": legacy_url,
                }
            ],
        )
        ranked = direction_service.rank_courses(
            "one", "变量与循环", courses_data=_one_course_direction(course)
        )
        self.assertEqual(len(ranked), 1)
        self.assertEqual(ranked[0]["section"], "变量与循环")
        self.assertEqual(ranked[0]["url"], self.CHAPTER_URL)
        self.assertNotEqual(ranked[0]["url"], legacy_url)
        self.assertNotEqual(ranked[0]["url"], self.COURSE_URL)


class RankCoursesTests(unittest.TestCase):
    def test_ranking_is_capped_by_k_courses(self) -> None:
        courses = _scope_direction()
        ranked = direction_service.rank_courses(
            "scope-demo", "Python Excel SQL Tableau 入门", courses_data=courses
        )
        self.assertLessEqual(len(ranked), direction_service.COURSE_CANDIDATE_K)
        self.assertEqual([item["rank"] for item in ranked], list(range(1, len(ranked) + 1)))

    def test_k_stays_below_every_direction_course_count(self) -> None:
        courses = load_courses()
        for direction in courses["directions"]:
            with self.subTest(direction=direction["id"]):
                self.assertLess(
                    direction_service.COURSE_CANDIDATE_K,
                    len(direction["courses"]),
                )

    def test_unknown_direction_and_blank_query_rank_nothing(self) -> None:
        courses = _scope_direction()
        self.assertEqual(
            direction_service.rank_courses("nope", "Python", courses_data=courses), []
        )
        self.assertEqual(
            direction_service.rank_courses("scope-demo", "   ", courses_data=courses), []
        )


class SkillGapRetrievalTests(unittest.TestCase):
    def _fixture(self) -> tuple[dict, dict]:
        jobs = {
            "directions": [
                {
                    "id": "gap-demo",
                    "name": "差距方向",
                    "jobs": [
                        {
                            "job_id": "j1",
                            "title": "岗",
                            "skills_required": ["数据分析", "数据清洗"],
                            "skills_preferred": [],
                        }
                    ],
                }
            ]
        }
        courses = {
            "directions": [
                {
                    "id": "gap-demo",
                    "name": "差距方向",
                    "description": "",
                    "skills": ["数据分析"],
                    "courses": [
                        _course(
                            "c-data",
                            name="数据分析实战",
                            skills=["数据分析"],
                            chapters=[
                                {
                                    "index": 1,
                                    "title": "第1章 描述统计",
                                    "sections": ["数据分析入门", "均值与方差"],
                                }
                            ],
                        )
                    ],
                }
            ]
        }
        return jobs, courses

    def test_gap_courses_come_from_ranking_with_rank_and_score(self) -> None:
        jobs, courses = self._fixture()
        payload = direction_service.compute_skill_gap(
            "gap-demo", [], jobs_data=jobs, courses_data=courses
        )
        gap = next(item for item in payload["gaps"] if item["skill"] == "数据分析")
        self.assertEqual([item["courseId"] for item in gap["courses"]], ["c-data"])
        ref = gap["courses"][0]
        self.assertEqual(ref["rank"], 1)
        self.assertGreater(ref["score"], 0)
        self.assertEqual(ref["section"], "数据分析入门")
        self.assertEqual(ref["url"], "https://www.icourse163.org/course/c-data")

    def test_shared_bigram_is_not_coverage(self) -> None:
        """数据清洗 shares 数据 with 数据分析 but no course teaches it."""
        jobs, courses = self._fixture()
        payload = direction_service.compute_skill_gap(
            "gap-demo", [], jobs_data=jobs, courses_data=courses
        )
        gap = next(item for item in payload["gaps"] if item["skill"] == "数据清洗")
        self.assertEqual(gap["courses"], [])

    def test_empty_ranking_gives_empty_courses(self) -> None:
        jobs, courses = self._fixture()
        with patch("app.services.retrieval.rank", return_value=[]):
            payload = direction_service.compute_skill_gap(
                "gap-demo", [], jobs_data=jobs, courses_data=courses
            )
        self.assertTrue(payload["gaps"])
        for gap in payload["gaps"]:
            self.assertEqual(gap["courses"], [])


class TopKDiscriminationTests(unittest.TestCase):
    """Two goal profiles on one direction must not produce the same shortlist."""

    def test_real_catalogue_distinguishes_different_finance_profiles(self) -> None:
        """The shipped corpus must yield distinct shortlists for distinct needs."""
        beginner = direction_service.rank_courses(
            "ai-finance",
            "财务数据分析\n零基础\n能使用 Excel 完成财务报表",
        )
        python_sql = direction_service.rank_courses(
            "ai-finance",
            "财务数据分析\n已有 Python 基础\n能编写 SQL 查询财务数据库",
        )
        self.assertTrue(beginner and python_sql)
        self.assertNotEqual(
            [item["courseId"] for item in beginner],
            [item["courseId"] for item in python_sql],
        )

    def _courses(self) -> dict:
        return {
            "directions": [
                {
                    "id": "level-demo",
                    "name": "分层方向",
                    "description": "",
                    "skills": ["Python"],
                    "courses": [
                        _course(
                            "c-beginner",
                            name="Python 零基础入门",
                            skills=["Python"],
                            chapters=[
                                {
                                    "index": 1,
                                    "title": "第1章 手把手起步",
                                    "sections": ["安装与第一个程序", "零基础变量练习"],
                                }
                            ],
                        ),
                        _course(
                            "c-advanced",
                            name="Python 进阶",
                            skills=["Python"],
                            chapters=[
                                {
                                    "index": 1,
                                    "title": "第1章 进阶语法",
                                    "sections": ["装饰器与闭包", "异步编程 asyncio"],
                                }
                            ],
                        ),
                    ],
                }
            ]
        }

    def test_profiles_do_not_share_the_same_order(self) -> None:
        courses = self._courses()
        beginner = direction_service.rank_courses(
            "level-demo",
            "Python\n零基础，没写过代码\n能写出第一个程序",
            courses_data=courses,
        )
        advanced = direction_service.rank_courses(
            "level-demo",
            "Python\n已有基础，会写装饰器\n能写出异步程序",
            courses_data=courses,
        )
        self.assertTrue(beginner and advanced)
        self.assertNotEqual(
            [item["courseId"] for item in beginner],
            [item["courseId"] for item in advanced],
        )


if __name__ == "__main__":
    unittest.main()
