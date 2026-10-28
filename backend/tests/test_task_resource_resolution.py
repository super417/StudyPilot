"""Resolve missing legacy resources from public catalog, without DB writes."""
from datetime import date
import uuid

import pytest

from app.models.entities import DailyTask
from app.routers.study import _task_result
from app.services import direction_service, planner_service, resource_links


@pytest.mark.parametrize("description", ["Pandas 入门", "学习 Series·DataFrame", "Pandas 入门 / Series·DataFrame", "Pandas 入门：学习 Series 与 DataFrame 的区别，用 dict 构造 10 行 4 列的订单表（订单号、城市、品类、金额），打印 head 与 dtypes"])
def test_no_direction_can_find_catalog_topic_without_goal_shortlist(description):
    scope = planner_service._course_url_scope({}, [])
    matches = scope(description)
    assert matches
    selected = planner_service._resolve_task_resource_url(None, matches)
    assert selected in matches
    assert resource_links.sanitize_resource_url(selected)
    metadata = matches[selected]
    assert direction_service.matches_task_outline(description, metadata)


@pytest.mark.parametrize("old_url", [None, "https://www.bilibili.com/", "https://www.xuetangx.com/?from=old"])
def test_read_enriches_old_tasks_without_mutating_history(old_url):
    task = DailyTask(id=uuid.uuid4(), phase_id=uuid.uuid4(), plan_id=uuid.uuid4(), task_date=date.today(), description="Pandas 入门 / Series·DataFrame", week_label="W01", status="pending", resource_url=old_url)
    result = _task_result(task)
    assert result["resourceUrl"]
    assert result["chapterTitle"] or result["sectionTitle"]
    assert resource_links.sanitize_resource_url(result["resourceUrl"])
    assert task.resource_url == old_url
    assert task.chapter_title is None


def test_unknown_topic_stays_empty_and_concrete_saved_video_stays_exact():
    task = DailyTask(id=uuid.uuid4(), phase_id=uuid.uuid4(), plan_id=uuid.uuid4(), task_date=date.today(), description="外星晶体量子魔法", week_label="W01", status="pending")
    assert _task_result(task)["resourceUrl"] is None
    task.resource_url = "https://www.bilibili.com/video/BV1Ti421v7Ey/?p=2"
    assert _task_result(task)["resourceUrl"] == task.resource_url


def test_numbered_generic_schedule_does_not_match_numbered_chapter():
    item = {"name": "Tableau 仪表盘", "chapterTitle": "第1章 Tableau", "sectionTitle": "仪表盘发布"}
    assert not direction_service.matches_task_outline("阶段 1：完成当日范围的巩固练习，产出 2 道错题", item)


def test_output_orders_do_not_replace_read_csv_knowledge_topic():
    item = {"name": "Python 数据分析", "chapterTitle": "文件处理", "sectionTitle": "8.8 利用文件处理模块批量制作销售订单"}
    assert not direction_service.matches_task_outline("Pandas read_csv：读取表格，产出销售订单", item)
    for match in direction_service.task_resource_candidates("Pandas read_csv：读取表格，产出销售订单"):
        assert "销售订单" not in str(match.get("sectionTitle"))
    assert direction_service.task_resource_candidates("高等数学：极限与连续") == []
