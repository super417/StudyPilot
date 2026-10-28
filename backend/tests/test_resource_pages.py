"""Resources require deep pages and task-specific catalog evidence."""
import pytest

from app.services import resource_links, planner_service


@pytest.mark.parametrize("url", [
    "https://www.xuetangx.com/", "https://www.bilibili.com/?from=roadmap",
    "https://www.bilibili.com/#video", "https://www.bilibili.com/search/video/BV123",
    "https://www.xuetangx.com/course/", "https://www.bilibili.com/video/",
    "https://www.xuetangx.com/login?next=/course/123",
])
def test_non_resource_pages_rejected(url):
    assert resource_links.sanitize_resource_url(url) is None


@pytest.mark.parametrize("url", [
    "https://www.bilibili.com/video/BV1Ti421v7Ey/?p=2",
    "https://www.xuetangx.com/training/course/33710117?channel=learn",
    "https://www.icourse163.org/course/CUFE-1470430193",
    "https://coursehome.zhihuishu.com/courseHome/1000095245",
    "https://www.coursera.org/learn/machine-learning",
    "https://ocw.mit.edu/courses/18-01-single-variable-calculus-fall-2006/",
])
def test_concrete_resource_pages_kept(url):
    assert resource_links.sanitize_resource_url(url) == url


def test_goal_context_cannot_supply_task_title_match():
    item = {"url": "https://www.icourse163.org/course/CUFE-123", "name": "Python 基础", "sectionTitle": "变量"}
    from app.services.direction_service import matches_task_outline
    assert not matches_task_outline("学习高数极限", item)
    assert matches_task_outline("学习 Python 变量", item)
    scope = planner_service._course_url_scope({"goalName": "Python 基础"}, [])
    assert scope("学习高数极限") == {}


def test_no_catalog_evidence_means_no_model_link():
    scope = planner_service._course_url_scope({}, [])
    assert scope("学习极限") == {}


def test_same_subject_different_topic_is_not_a_title_match():
    from app.services.direction_service import matches_task_outline
    item = {"name": "高等数学", "chapterTitle": "导数", "sectionTitle": "求导法则"}
    assert not matches_task_outline("学习高等数学极限", item)
    assert matches_task_outline("学习高等数学求导法则", item)
    assert matches_task_outline("学习高等数学", item)


def test_both_planning_prompts_require_no_homepage_fallback():
    for prompt in (planner_service._PLAN_SYSTEM_PROMPT, planner_service._PLAN_SYSTEM_PROMPT_SOFT):
        assert "不确定具体课程页时填平台首页" not in prompt
        assert "找不到具体资源页就留空" in prompt
