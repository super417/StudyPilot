"""星藤航图：星级、日状态、鼓励语都是现算，不落库。

颗数看当天任务完成率，颜色看当天作答正确率。两套数故意分开：
完成率回答「做了多少」，正确率回答「做得对不对」。

``carried`` 留在当天分母里，算没做完。这和阶段进度排除 carried
**故意不同**——阶段进度要避免同一件事数两遍，日星级要反映那天的实情。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from app.core.clock import CHINA_TZ

# 两星 / 三星 / 四星的完成率下界（含边界）。边界归上一档：40→2、60→3、80→4。
# 前端 `journeyStars.ts` 必须抄同一组数，由阈值一致性测试锁住。
STAR_THRESHOLDS = (40, 60, 80)

# 与 weekly_review_service._EVIDENCE_SCORE 相同。partial 是 50，不是 0 也不是 100。
EVIDENCE_SCORE = {"correct": 100, "partial": 50, "wrong": 0}

# 正确率配色档。未作答不走这里，单独是 gray，避免和「答了但很差」混成同一种灰。
COLOR_THRESHOLDS = (40, 60, 80)

MAX_RANGE_DAYS = 400


def compute_stars(total: int, done: int) -> int | None:
    """由完成率给出 1–4 星。没有任务的日子返回 None，不记 0 星。

    有任务但一项都没做，仍是 1 星（完成率 0% < 40%）。这样「没做」和
    「这一天根本没排任务」能分开：后者不占星、不算断签。

    比较写成 ``done * 100 >= 阈值 * total``，不先做除法，避开浮点边界。
    """
    if total <= 0:
        return None
    if done < 0:
        done = 0
    if done > total:
        done = total
    if done * 100 >= STAR_THRESHOLDS[2] * total:
        return 4
    if done * 100 >= STAR_THRESHOLDS[1] * total:
        return 3
    if done * 100 >= STAR_THRESHOLDS[0] * total:
        return 2
    return 1


def completion_percent(total: int, done: int) -> int | None:
    """展示用完成率，向下取整。

    不用四舍五入：79/200 = 39.5%，四舍五入会写成 40%，但整数比较仍是 1 星。
    向下取整后，屏幕上的百分数和星档不会打架。
    """
    if total <= 0:
        return None
    if done < 0:
        done = 0
    if done > total:
        done = total
    return (done * 100) // total


def classify_day(day: date, today: date, total: int) -> str:
    """past / today / future / empty。

    未来日即使已经排了任务也是 future（花苞，不露星）。
    今天或过去且 total=0 是 empty（嫩芽，休息日或不排任务），不是 0 星。
    """
    if day > today:
        return "future"
    if total <= 0:
        return "empty"
    if day == today:
        return "today"
    return "past"


def accuracy_percent(score_sum: int, answered: int) -> int | None:
    """正确率展示值。没作答是 None，不是 0。"""
    if answered <= 0:
        return None
    return int(round(score_sum / answered))


def star_color(score_sum: int, answered: int) -> str:
    """有作答时的配色档。调用方负责「没作答 → gray」和「不显示星 → null」。

    每题得分已经是 0–100，所以平均分 ≥ 阈值写成 ``score_sum >= 阈值 * answered``。
    不要套用星数那条 ``done * 100 >= 阈值 * total``：得分不是「做完的条数」。
    vivid ≥80，warm ≥60，cool ≥40，其余 muted。边界归更亮的一档。
    """
    if answered <= 0:
        return "gray"
    if score_sum >= COLOR_THRESHOLDS[2] * answered:
        return "vivid"
    if score_sum >= COLOR_THRESHOLDS[1] * answered:
        return "warm"
    if score_sum >= COLOR_THRESHOLDS[0] * answered:
        return "cool"
    return "muted"


def tasks_until_four_stars(total: int, done: int) -> int:
    """再完成几项，完成率才能到 80%（4 星）。已经是 4 星则为 0。"""
    if total <= 0:
        return 0
    if done < 0:
        done = 0
    if done > total:
        done = total
    # ceil(80 * total / 100) - done，用整数上限。
    needed = (80 * total + 99) // 100
    return max(0, needed - done)


def evidence_local_day(moment: datetime) -> date:
    """``mastery_evidence.created_at`` 按中国时区（UTC+8）切日。

    库存的是 UTC。直接取 ``.date()`` 会把东八区凌晨的作答算到前一天，
    练习列表曾经踩过这个坑。无时区的值当作 UTC。
    """
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(CHINA_TZ).date()


def tally_statuses(statuses: list[str]) -> dict[str, int]:
    """把一天的任务状态收成 total/done/carried/pending。

    ``carried`` 算进 total，不算进 done。顺延副本是另一天的任务，不在这里。
    """
    total = len(statuses)
    done = sum(1 for status in statuses if status == "done")
    carried = sum(1 for status in statuses if status == "carried")
    pending = sum(1 for status in statuses if status == "pending")
    return {"total": total, "done": done, "carried": carried, "pending": pending}


@dataclass(frozen=True)
class DayTally:
    """聚合查询吐出的一天原料。纯函数 ``project_day`` 负责变成给前端的形状。"""

    day: date
    total: int = 0
    done: int = 0
    carried: int = 0
    pending: int = 0
    score_sum: int = 0
    answered: int = 0
    has_check_in: bool = False
    minutes: int = 0
    tags: tuple[str, ...] = ()


@dataclass(frozen=True)
class DayView:
    day: date
    total: int
    done: int
    carried: int
    pending: int
    rate: int | None
    stars: int | None
    accuracy: int | None
    star_color: str | None
    has_check_in: bool
    minutes: int
    tags: tuple[str, ...]
    state: str


def project_day(tally: DayTally, today: date) -> DayView:
    """一天的展示口径。未来和空日不给星，也不给颜色。"""
    state = classify_day(tally.day, today, tally.total)
    show_stars = state in ("past", "today")
    stars = compute_stars(tally.total, tally.done) if show_stars else None
    rate = completion_percent(tally.total, tally.done) if show_stars else None
    if not show_stars:
        accuracy = None
        color = None
    elif tally.answered <= 0:
        accuracy = None
        color = "gray"
    else:
        accuracy = accuracy_percent(tally.score_sum, tally.answered)
        color = star_color(tally.score_sum, tally.answered)
    return DayView(
        day=tally.day,
        total=tally.total,
        done=tally.done,
        carried=tally.carried,
        pending=tally.pending,
        rate=rate,
        stars=stars,
        accuracy=accuracy,
        star_color=color,
        has_check_in=tally.has_check_in,
        minutes=tally.minutes,
        tags=tally.tags,
        state=state,
    )


def best_checkin_streak(dates: set[date], today: date) -> int:
    """今天及以前最长的连续打卡。空集是 0。"""
    ordered = sorted(day for day in dates if day <= today)
    best = 0
    run = 0
    previous: date | None = None
    for day in ordered:
        if previous is not None and day - previous == timedelta(days=1):
            run += 1
        else:
            run = 1
        if run > best:
            best = run
        previous = day
    return best


def sum_stars(views: list[DayView], start: date, end: date) -> int:
    """闭区间里已经点亮的星。空日和未来日的 None 不加。"""
    total = 0
    for view in views:
        if view.day < start or view.day > end or view.stars is None:
            continue
        total += view.stars
    return total


def full_clear_streak(views: list[DayView], today: date) -> int:
    """连续全清天数，截止到今天；今天没全清就截止到昨天。

    无任务日跳过，不把连续全清掐断（和「空日不算断签」一致）。
    """
    by_day = {view.day: view for view in views}

    def meaningful(cursor: date) -> DayView | None:
        """从 cursor 往回跳过空日，返回第一个有任务的日子。"""
        for _ in range(MAX_RANGE_DAYS + 1):
            view = by_day.get(cursor)
            if view is None:
                return None
            if view.total > 0 and view.state != "future":
                return view
            cursor = cursor - timedelta(days=1)
        return None

    start = meaningful(today)
    if start is None:
        return 0
    if start.day == today and start.rate != 100:
        start = meaningful(today - timedelta(days=1))
    if start is None or start.rate != 100:
        return 0

    count = 0
    cursor = start.day
    for _ in range(MAX_RANGE_DAYS + 1):
        view = by_day.get(cursor)
        if view is None:
            break
        if view.total <= 0 or view.state == "future":
            cursor = cursor - timedelta(days=1)
            continue
        if view.rate != 100:
            break
        count += 1
        cursor = cursor - timedelta(days=1)
    return count
