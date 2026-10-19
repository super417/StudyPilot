"""星藤航图纯函数：星数、颜色、空日、carried 口径。"""

from __future__ import annotations

import unittest
from datetime import date, datetime, timedelta, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

from app.services.journey_service import (
    COLOR_THRESHOLDS,
    EVIDENCE_SCORE,
    STAR_THRESHOLDS,
    DayTally,
    accuracy_percent,
    classify_day,
    completion_percent,
    best_checkin_streak,
    compute_stars,
    evidence_local_day,
    full_clear_streak,
    project_day,
    select_cheer,
    star_color,
    sum_stars,
    tally_statuses,
    tasks_until_four_stars,
)
from app.services.weekly_review_service import _EVIDENCE_SCORE

TODAY = date(2026, 10, 19)


class JourneyStarTests(unittest.TestCase):
    def test_thresholds_are_the_locked_boundaries(self) -> None:
        self.assertEqual(STAR_THRESHOLDS, (40, 60, 80))
        self.assertEqual(COLOR_THRESHOLDS, (40, 60, 80))

    def test_evidence_scores_match_weekly_review(self) -> None:
        self.assertEqual(EVIDENCE_SCORE, _EVIDENCE_SCORE)
        self.assertEqual(EVIDENCE_SCORE, {"correct": 100, "partial": 50, "wrong": 0})

    def test_no_tasks_is_not_a_star(self) -> None:
        self.assertIsNone(compute_stars(0, 0))
        self.assertIsNone(completion_percent(0, 0))

    def test_zero_done_is_one_star(self) -> None:
        # 用户定的口径：<40% 一律 1 星，包括一项都没做。
        self.assertEqual(compute_stars(4, 0), 1)
        self.assertEqual(completion_percent(4, 0), 0)

    def test_boundary_table(self) -> None:
        # total=100，边界值归上一档。
        cases = {
            0: 1,
            39: 1,
            40: 2,
            59: 2,
            60: 3,
            79: 3,
            80: 4,
            100: 4,
        }
        for done, stars in cases.items():
            self.assertEqual(compute_stars(100, done), stars, done)
            self.assertEqual(completion_percent(100, done), done)

    def test_integer_compare_does_not_round_39_5_up_to_two_stars(self) -> None:
        # 79/200 = 39.5%。四舍五入会显示成 40，但真实完成率不到 40，仍是 1 星。
        self.assertEqual(compute_stars(200, 79), 1)
        self.assertEqual(completion_percent(200, 79), 39)

    def test_exact_40_percent_is_two_stars(self) -> None:
        self.assertEqual(compute_stars(5, 2), 2)
        self.assertEqual(completion_percent(5, 2), 40)

    def test_partial_answer_is_not_gray(self) -> None:
        # 只做对一半：50 分落在 cool，不是「没作答」的灰。
        self.assertEqual(star_color(50, 1), "cool")
        self.assertEqual(accuracy_percent(50, 1), 50)
        self.assertIsNone(accuracy_percent(0, 0))
        self.assertEqual(star_color(0, 0), "gray")

    def test_color_boundaries(self) -> None:
        # 参数是（得分和, 题数）。一题 39 分不到 40 档。
        self.assertEqual(star_color(39, 1), "muted")
        self.assertEqual(star_color(40, 1), "cool")
        self.assertEqual(star_color(60, 1), "warm")
        self.assertEqual(star_color(80, 1), "vivid")
        self.assertEqual(star_color(0, 3), "muted")

    def test_tasks_until_four_stars(self) -> None:
        self.assertEqual(tasks_until_four_stars(5, 3), 1)
        self.assertEqual(tasks_until_four_stars(5, 4), 0)
        self.assertEqual(tasks_until_four_stars(1, 0), 1)
        self.assertEqual(tasks_until_four_stars(0, 0), 0)

    def test_carried_stays_in_the_denominator(self) -> None:
        # 当天 1 条做完、1 条被标成 carried：分母是 2，不是 1。
        # 若照搬阶段进度（丢掉 carried），这天会变成 100% 四星。
        tallied = tally_statuses(["done", "carried"])
        self.assertEqual(tallied, {"total": 2, "done": 1, "carried": 1, "pending": 0})
        self.assertEqual(compute_stars(tallied["total"], tallied["done"]), 2)
        self.assertEqual(completion_percent(tallied["total"], tallied["done"]), 50)

    def test_classify_day(self) -> None:
        self.assertEqual(classify_day(TODAY, TODAY, 3), "today")
        self.assertEqual(classify_day(TODAY, TODAY, 0), "empty")
        self.assertEqual(classify_day(date(2026, 10, 18), TODAY, 3), "past")
        self.assertEqual(classify_day(date(2026, 10, 18), TODAY, 0), "empty")
        self.assertEqual(classify_day(date(2026, 10, 20), TODAY, 0), "future")
        self.assertEqual(classify_day(date(2026, 10, 20), TODAY, 4), "future")

    def test_project_day_hides_stars_in_the_future_and_on_rest_days(self) -> None:
        future = project_day(DayTally(date(2026, 10, 20), total=4, done=0), TODAY)
        self.assertEqual(future.state, "future")
        self.assertIsNone(future.stars)
        self.assertIsNone(future.star_color)

        rest = project_day(DayTally(date(2026, 10, 18), total=0), TODAY)
        self.assertEqual(rest.state, "empty")
        self.assertIsNone(rest.stars)
        self.assertIsNone(rest.rate)

    def test_project_day_unanswered_is_gray_not_zero_accuracy(self) -> None:
        view = project_day(DayTally(TODAY, total=4, done=4, answered=0), TODAY)
        self.assertEqual(view.stars, 4)
        self.assertEqual(view.star_color, "gray")
        self.assertIsNone(view.accuracy)
        self.assertEqual(view.state, "today")

    def test_project_day_colors_from_evidence(self) -> None:
        view = project_day(
            DayTally(date(2026, 10, 17), total=4, done=4, score_sum=700, answered=9),
            TODAY,
        )
        self.assertEqual(view.state, "past")
        self.assertEqual(view.stars, 4)
        self.assertEqual(view.rate, 100)
        self.assertEqual(view.accuracy, 78)
        self.assertEqual(view.star_color, "warm")

    def test_evidence_local_day_uses_china_timezone(self) -> None:
        # 2026-10-18 16:00 UTC = 2026-10-19 00:00 CST，算 19 日。
        late = datetime(2026, 10, 18, 16, 0, tzinfo=timezone.utc)
        self.assertEqual(evidence_local_day(late), date(2026, 10, 19))
        # 早一分钟仍是 18 日。
        before = datetime(2026, 10, 18, 15, 59, tzinfo=timezone.utc)
        self.assertEqual(evidence_local_day(before), date(2026, 10, 18))
        # 无时区按 UTC。
        naive = datetime(2026, 10, 18, 16, 0)
        self.assertEqual(evidence_local_day(naive), date(2026, 10, 19))

    def test_full_clear_streak_skips_rest_days_and_can_end_yesterday(self) -> None:
        def view(offset: int, done: int, total: int) -> DayTally:
            return project_day(
                DayTally(TODAY - timedelta(days=offset), total=total, done=done),
                TODAY,
            )

        # 今天 75% 不算，昨天和前天全清，中间没有空日 → 2。
        views = [view(0, 3, 4), view(1, 4, 4), view(2, 4, 4), view(3, 1, 4)]
        self.assertEqual(full_clear_streak(views, TODAY), 2)

        # 今天全清，昨天休息，前天全清：休息日不掐断 → 2。
        views = [view(0, 2, 2), view(1, 0, 0), view(2, 3, 3)]
        self.assertEqual(full_clear_streak(views, TODAY), 2)

    def test_best_streak_and_week_stars(self) -> None:
        dates = {
            date(2026, 10, 1),
            date(2026, 10, 2),
            date(2026, 10, 4),
            date(2026, 10, 5),
            date(2026, 10, 6),
        }
        self.assertEqual(best_checkin_streak(dates, TODAY), 3)
        self.assertEqual(best_checkin_streak(set(), TODAY), 0)

        views = [
            project_day(DayTally(date(2026, 10, 19), total=4, done=4), TODAY),
            project_day(DayTally(date(2026, 10, 18), total=4, done=2), TODAY),
            project_day(DayTally(date(2026, 10, 12), total=4, done=4), TODAY),
        ]
        # 2026-10-19 是周一。本周只有 19 日的 4 星；上周同一天（12 日，也是周一）4 星。
        self.assertEqual(date(2026, 10, 19).weekday(), 0)
        self.assertEqual(sum_stars(views, date(2026, 10, 19), date(2026, 10, 19)), 4)
        self.assertEqual(sum_stars(views, date(2026, 10, 12), date(2026, 10, 12)), 4)


class JourneyCheerTests(unittest.TestCase):
    """方案 6.4 的样例：10-13 到 10-19 完成率 50/0/60/80/100/100/75。"""

    def _views(self):
        script = [
            (6, 2, 4),
            (5, 0, 4),
            (4, 3, 5),
            (3, 4, 5),
            (2, 4, 4),
            (1, 4, 4),
            (0, 3, 4),
        ]
        return [
            project_day(DayTally(TODAY - timedelta(days=offset), total=total, done=done), TODAY)
            for offset, done, total in script
        ]

    def _cheer(self, exclude: set[str] | None = None, **kwargs):
        views = self._views()
        return select_cheer(
            views,
            today=TODAY,
            plan_start=date(2026, 10, 1),
            streak_days=kwargs.get("streak", 0),
            best_streak=kwargs.get("best", 0),
            full_clear=full_clear_streak(views, TODAY),
            week_stars=0,
            last_week_stars=0,
            scope="week",
            focus=None,
            exclude=exclude or set(),
        )

    def test_example_priority_and_day_lines(self) -> None:
        first = self._cheer()
        self.assertEqual(first.rule_id, "R1")
        self.assertIn("连续 2 天", first.text)
        self.assertNotIn("效率", first.text)

        second = self._cheer({"R1"})
        self.assertEqual(second.rule_id, "R2")
        self.assertIn("47%", second.text)
        self.assertIn("92%", second.text)

        third = self._cheer({"R1", "R2"})
        self.assertEqual(third.rule_id, "R4")
        self.assertIn("3/4", third.text)
        self.assertIn("再完成 1 项", third.text)

        missed = select_cheer(
            self._views(),
            today=TODAY,
            plan_start=date(2026, 10, 1),
            streak_days=0,
            best_streak=0,
            full_clear=0,
            week_stars=0,
            last_week_stars=0,
            scope="day",
            focus=date(2026, 10, 14),
            exclude=set(),
        )
        self.assertIn("10-14 这天没有完成任务", missed.text)
        self.assertIn("之后 5 天", missed.text)
        self.assertTrue(missed.suggest_roadmap)

        cleared = select_cheer(
            self._views(),
            today=TODAY,
            plan_start=date(2026, 10, 1),
            streak_days=0,
            best_streak=0,
            full_clear=0,
            week_stars=0,
            last_week_stars=0,
            scope="day",
            focus=date(2026, 10, 17),
            exclude=set(),
        )
        self.assertIn("10-17 全清 4/4", cleared.text)


class JourneyStarPropertyTests(unittest.TestCase):
    @settings(max_examples=200, deadline=None)
    @given(
        st.integers(min_value=0, max_value=40),
        st.integers(min_value=0, max_value=40),
    )
    def test_stars_follow_integer_thresholds(self, total: int, done: int) -> None:
        if done > total:
            done = total
        stars = compute_stars(total, done)
        if total == 0:
            self.assertIsNone(stars)
            return
        self.assertIn(stars, (1, 2, 3, 4))
        if done * 100 >= 80 * total:
            self.assertEqual(stars, 4)
        elif done * 100 >= 60 * total:
            self.assertEqual(stars, 3)
        elif done * 100 >= 40 * total:
            self.assertEqual(stars, 2)
        else:
            self.assertEqual(stars, 1)
        shown = completion_percent(total, done)
        assert shown is not None
        self.assertLess(shown, 40) if stars == 1 else None
        if stars == 1:
            self.assertLess(shown, 40)
        elif stars == 2:
            self.assertGreaterEqual(shown, 40)
            self.assertLess(shown, 60)
        elif stars == 3:
            self.assertGreaterEqual(shown, 60)
            self.assertLess(shown, 80)
        else:
            self.assertGreaterEqual(shown, 80)

    @settings(max_examples=80, deadline=None)
    @given(st.integers(min_value=1, max_value=30))
    def test_more_done_never_lowers_stars(self, total: int) -> None:
        previous = compute_stars(total, 0)
        assert previous is not None
        for done in range(1, total + 1):
            current = compute_stars(total, done)
            assert current is not None
            self.assertGreaterEqual(current, previous)
            previous = current


if __name__ == "__main__":
    unittest.main()
