import asyncio
import json
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.base import Base
from app.models.entities import ChatMessage, Conversation, DailyTask, Phase, Plan, User
from app.services import assistant_service, video_link
from app.services.ai_proxy import ResolvedCredential
from app.services.video_draft_store import VideoDraft, video_draft_store


URL_A = "https://www.bilibili.com/video/BV1b7411N798"
URL_B = "https://www.bilibili.com/video/BV1SiDYBeET5"
NOW = datetime(2026, 10, 4, 21, 0)


def material(url=URL_A, title="王道数据结构", duration=14400):
    return {
        "url": url,
        "title": title,
        "source": "王道",
        "summary": "线性表与树",
        "body": "",
        "sections": [
            {"label": "P1 线性表", "url": url, "duration": duration},
        ],
    }


@pytest.fixture
def chat(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("DB_PASSWORD", "temporary-test-password")
    get_settings.cache_clear()
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = Session(engine, expire_on_commit=False)
    user = User(username="workflow-test", password_hash="test-hash")
    session.add(user)
    session.flush()
    plan = Plan(
        user_id=user.id,
        goal_name="408",
        start_date=date(2026, 10, 1),
        goal_date=date(2026, 12, 31),
        current_level="基础",
        daily_minutes=120,
        total_phases=2,
    )
    session.add(plan)
    session.flush()
    session.add(
        Phase(
            plan_id=plan.id,
            phase_index=1,
            name="数据结构基础",
            start_date=plan.start_date,
            end_date=plan.goal_date,
            is_current=True,
        )
    )
    session.commit()
    video_draft_store.clear()
    payloads = []
    fetched = []
    materials = {
        URL_A: material(),
        URL_B: {
            **material(URL_B, "数据结构专题", 3600),
            "source": "专题老师",
            "summary": "树与图的专题复习",
            "sections": [
                {"label": "P1 树", "url": URL_B, "duration": 1800},
                {"label": "P2 图", "url": URL_B + "?p=2", "duration": 1800},
            ],
        },
    }
    monkeypatch.setattr(assistant_service, "has_verified_api_config", lambda *_: True)
    monkeypatch.setattr(
        assistant_service,
        "resolve_credential",
        lambda *_: ResolvedCredential("test-key", "test-model", "https://example.com"),
    )

    @asynccontextmanager
    async def factory(_credential, payload):
        payloads.append(payload)

        async def chunks():
            yield "正常回答"

        yield chunks()

    async def fetcher(url):
        fetched.append(url)
        return materials.get(url)

    def reply(message, now=NOW):
        async def run():
            frames = []
            async for frame in assistant_service.stream_assistant_reply(
                session, user.id, message, None,
                video_fetcher=fetcher, stream_factory=factory, now=now,
            ):
                if "event: token" in frame:
                    frames.append(json.loads(frame.split("data: ", 1)[1])["delta"])
            return "".join(frames)

        return asyncio.run(run())

    state = {
        "session": session, "user": user, "plan": plan, "reply": reply,
        "payloads": payloads, "fetched": fetched, "materials": materials,
        "count": lambda: session.scalar(select(func.count()).select_from(DailyTask)),
    }
    yield state
    video_draft_store.clear()
    session.close()
    engine.dispose()
    get_settings.cache_clear()


def test_draft_question_keeps_study_and_read_material_context(chat):
    chat["reply"](URL_A)
    assert chat["reply"]("这门课适合零基础吗") == "正常回答"
    content = chat["payloads"][-1]["messages"][-1]["content"]
    assert "目标「408」" in content
    assert "王道数据结构" in content
    assert "P1 线性表" in content
    assert chat["count"]() == 0
    assert chat["fetched"] == [URL_A]


def test_draft_expires_after_30_minutes_and_cannot_schedule(chat):
    video_draft_store.put(VideoDraft(
        user_id=chat["user"].id, material=material(), url=URL_A,
        suggested_start=date(2026, 10, 5), created_at=NOW,
    ))
    assert video_draft_store.get(chat["user"].id, NOW + timedelta(minutes=30))
    chat["reply"]("好", NOW + timedelta(minutes=30, seconds=1))
    assert video_draft_store.get(chat["user"].id, NOW + timedelta(minutes=31)) is None
    assert chat["count"]() == 0
    assert len(chat["payloads"]) == 1


@pytest.mark.parametrize("agreement", ["好", "可以", "行", "要", "嗯", "好的"])
def test_agreement_previews_date_range_before_second_confirmation(chat, agreement):
    chat["reply"](URL_A)
    preview = chat["reply"](agreement)
    assert chat["count"]() == 0
    assert "2026-10-05" in preview
    assert "2026-10-06" in preview
    assert "确认" in preview
    assert "王道数据结构" in preview

    written = chat["reply"]("确认")
    tasks = list(chat["session"].scalars(select(DailyTask).order_by(DailyTask.task_date)))
    assert [task.task_date for task in tasks] == [date(2026, 10, 5), date(2026, 10, 6)]
    assert all(task.resource_url == URL_A for task in tasks)
    assert "排进" in written
    assert video_draft_store.get(chat["user"].id, NOW) is None


def test_second_short_agreement_confirms_the_previewed_range(chat):
    chat["reply"](URL_A)
    chat["reply"]("好")
    assert chat["count"]() == 0
    chat["reply"]("可以")
    assert chat["count"]() == 2


@pytest.mark.parametrize(
    "message",
    [
        f"408数据结构 {URL_A} 还是 {URL_B}，哪个好？",
        "408数据结构要BV1b7411N798还是BV1SiDYBeET5",
    ],
)
def test_comparison_reads_every_link_and_does_not_schedule(chat, message):
    reply = chat["reply"](message)
    assert chat["fetched"] == [URL_A, URL_B]
    assert chat["count"]() == 0
    for fact in (
        "王道数据结构", "数据结构专题", "线性表", "树", "图",
        "240", "60", "王道", "专题老师",
        "章节", "时长", "覆盖", "来源", "优势", "劣势",
    ):
        assert fact in reply
    assert "选择" in reply or "选定" in reply


@pytest.mark.parametrize(
    "message",
    ["好", "明天", "按这个排", "第二个适合零基础吗", f"{URL_B} 适合零基础吗"],
)
def test_comparison_cannot_schedule_without_an_explicit_choice(chat, message):
    chat["reply"](f"{URL_A} 和 {URL_B} 哪个好")
    chat["reply"](message)
    assert chat["count"]() == 0
    assert chat["fetched"] == [URL_A, URL_B]
    if "适合" in message:
        content = chat["payloads"][-1]["messages"][-1]["content"]
        assert "王道数据结构" in content and "数据结构专题" in content


@pytest.mark.parametrize(
    "choice",
    [
        "选第二个", "选B", "选专题老师", "数据结构专题",
        "BV1SiDYBeET5", URL_B + "?spm_id_from=333",
    ],
)
def test_only_selected_course_is_scheduled_after_comparison(chat, choice):
    chat["reply"](f"{URL_A} 和 {URL_B} 哪个好")
    selected = chat["reply"](choice)
    assert "数据结构专题" in selected
    assert chat["count"]() == 0
    chat["reply"]("明天")
    tasks = list(chat["session"].scalars(select(DailyTask)))
    assert len(tasks) == 1
    assert tasks[0].task_date == date(2026, 10, 5)
    assert tasks[0].resource_url == URL_B
    assert "按《数据结构专题》" in tasks[0].description
    assert "按《王道数据结构》" not in tasks[0].description
    assert "P1 树" in tasks[0].description
    assert "P2 图" in tasks[0].description
    assert chat["fetched"] == [URL_A, URL_B]


def test_selection_still_requires_preview_for_a_short_agreement(chat):
    chat["reply"](f"{URL_A} 和 {URL_B} 哪个好")
    chat["reply"]("选第一个")
    preview = chat["reply"]("好")
    assert chat["count"]() == 0
    assert "2026-10-05" in preview and "2026-10-06" in preview
    chat["reply"]("确认")
    tasks = list(chat["session"].scalars(select(DailyTask)))
    assert len(tasks) == 2
    assert all(task.resource_url == URL_A for task in tasks)


def test_unreadable_candidate_is_reported_and_cannot_be_selected(chat):
    chat["materials"][URL_B] = None
    reply = chat["reply"](f"{URL_A} 和 {URL_B} 哪个好")
    assert chat["fetched"] == [URL_A, URL_B]
    assert URL_B in reply
    assert "这个没读到" in reply
    assert "专题老师" not in reply and "树与图的专题复习" not in reply
    assert chat["count"]() == 0

    selected = chat["reply"]("选第二个")
    assert "这个没读到" in selected
    chat["reply"]("明天")
    assert chat["count"]() == 0
    chat["reply"]("选第一个")
    chat["reply"]("明天")
    tasks = list(chat["session"].scalars(select(DailyTask)))
    assert len(tasks) == 2
    assert all(task.resource_url == URL_A for task in tasks)


def test_reselecting_a_course_discards_the_old_pending_range(chat):
    chat["reply"](f"{URL_A} 和 {URL_B} 哪个好")
    chat["reply"]("选第一个")
    chat["reply"]("好")
    selected = chat["reply"]("改选第二个")
    assert "数据结构专题" in selected
    preview = chat["reply"]("好")
    assert chat["count"]() == 0
    assert "2026-10-05" in preview and "2026-10-06" not in preview
    chat["reply"]("确认")
    tasks = list(chat["session"].scalars(select(DailyTask)))
    assert len(tasks) == 1
    assert tasks[0].resource_url == URL_B
    assert chat["fetched"] == [URL_A, URL_B]


def test_reselecting_an_unread_course_cannot_schedule_the_previous_choice(chat):
    chat["materials"][URL_B] = None
    chat["reply"](f"{URL_A} 和 {URL_B} 哪个好")
    chat["reply"]("选第一个")
    chat["reply"]("好")
    assert "这个没读到" in chat["reply"]("改选第二个")
    chat["reply"]("确认")
    assert chat["count"]() == 0


def test_resending_an_unread_candidate_retries_fetching_it(chat):
    course_b = chat["materials"][URL_B]
    chat["materials"][URL_B] = None
    chat["reply"](f"{URL_A} 和 {URL_B} 哪个好")
    chat["materials"][URL_B] = course_b
    selected = chat["reply"](URL_B)
    assert chat["fetched"] == [URL_A, URL_B, URL_B]
    assert "数据结构专题" in selected
    assert chat["count"]() == 0
    chat["reply"]("明天")
    tasks = list(chat["session"].scalars(select(DailyTask)))
    assert len(tasks) == 1 and tasks[0].resource_url == URL_B


def test_comparison_does_not_invent_unknown_duration_or_coverage(chat):
    chat["materials"][URL_B].update(summary="", source="")
    chat["materials"][URL_B]["sections"] = [
        {"label": "定义", "url": URL_B, "duration": 0}
    ]
    reply = chat["reply"](f"{URL_A} 和 {URL_B} 哪个好")
    assert chat["fetched"] == [URL_A, URL_B]
    assert "时长" in reply and "没读到" in reply
    assert "定义" in reply
    assert "树与图的专题复习" not in reply
    assert "专题老师" not in reply
    assert chat["count"]() == 0


def test_comparison_context_survives_follow_up_without_refetching(chat):
    chat["reply"](f"{URL_A} 和 {URL_B} 哪个好")
    assert chat["reply"]("我每天两小时，更适合哪门") == "正常回答"
    content = chat["payloads"][-1]["messages"][-1]["content"]
    assert "目标「408」" in content
    assert "王道数据结构" in content and "数据结构专题" in content
    assert "P1 线性表" in content and "P2 图" in content
    assert chat["count"]() == 0
    assert chat["fetched"] == [URL_A, URL_B]


def test_a_title_only_page_is_not_presented_as_a_chapter_outline(chat):
    chat["materials"][URL_B] = video_link.material_from_html(
        URL_B, "<html><head><title>数据结构笔记</title></head>"
        "<body><p>关于线性表的笔记。</p></body></html>",
    )
    reply = chat["reply"](f"{URL_A} 和 {URL_B} 哪个好")
    note = reply.split("2. 《数据结构笔记》", 1)[1]
    assert "没读到章节目录" in note
    assert "只读到目录：数据结构笔记" not in note
    assert chat["count"]() == 0


def test_new_link_discards_an_old_pending_confirmation(chat):
    chat["reply"](URL_A)
    chat["reply"]("好")
    chat["reply"](URL_B)
    chat["reply"]("确认")
    assert chat["count"]() == 0
    chat["reply"]("好")
    tasks = list(chat["session"].scalars(select(DailyTask)))
    assert len(tasks) == 1
    assert tasks[0].resource_url == URL_B


def test_three_links_are_all_read_and_can_select_the_third(chat):
    url_c = "https://example.com/notes"
    chat["materials"][url_c] = material(url_c, "数据结构笔记", 0)
    reply = chat["reply"](f"{URL_A} 和 {URL_B} 还是 {url_c} 哪个好")
    assert chat["fetched"] == [URL_A, URL_B, url_c]
    assert "数据结构笔记" in reply
    assert chat["count"]() == 0
    chat["reply"]("选第三个")
    assert chat["count"]() == 0
    chat["reply"]("明天")
    tasks = list(chat["session"].scalars(select(DailyTask)))
    assert len(tasks) == 1
    assert "按《数据结构笔记》" in tasks[0].description


def test_a_fetch_error_does_not_skip_the_remaining_link(chat, monkeypatch):
    async def fetcher(url):
        chat["fetched"].append(url)
        if url == URL_A:
            raise RuntimeError("upstream unavailable")
        return chat["materials"].get(url)

    monkeypatch.setattr(assistant_service, "fetch_link", fetcher)

    async def run():
        parts = []
        async for frame in assistant_service.stream_assistant_reply(
            chat["session"], chat["user"].id, f"{URL_A} 和 {URL_B} 哪个好",
            None, now=NOW,
        ):
            if "event: token" in frame:
                parts.append(json.loads(frame.split("data: ", 1)[1])["delta"])
        return "".join(parts)

    reply = asyncio.run(run())
    assert chat["fetched"] == [URL_A, URL_B]
    assert "这个没读到" in reply
    assert "数据结构专题" in reply
    assert "王道数据结构" not in reply
    assert chat["count"]() == 0


def test_comparison_expires_without_allowing_an_old_choice(chat):
    chat["reply"](f"{URL_A} 和 {URL_B} 哪个好")
    chat["reply"]("选第二个", NOW + timedelta(minutes=31))
    assert video_draft_store.get(chat["user"].id, NOW + timedelta(minutes=31)) is None
    assert chat["count"]() == 0


def test_expired_comparison_history_cannot_implicitly_adopt_the_first_link(chat):
    conversation = Conversation(user_id=chat["user"].id)
    chat["session"].add(conversation)
    chat["session"].flush()
    chat["session"].add_all(
        [
            ChatMessage(
                conversation_id=conversation.id, role="user", content=URL_A, position=0,
            ),
            ChatMessage(
                conversation_id=conversation.id, role="user",
                content=f"{URL_A} 和 {URL_B} 哪个好", position=1,
            ),
        ]
    )
    chat["session"].commit()
    chat["reply"](f"{URL_A} 和 {URL_B} 哪个好")
    later = NOW + timedelta(minutes=31)
    chat["reply"]("好", later)
    chat["reply"]("明天", later)
    assert chat["fetched"] == [URL_A, URL_B]
    assert video_draft_store.get(chat["user"].id, later) is None
    assert chat["count"]() == 0


@pytest.mark.parametrize("message", ["不要按这个排", "先别加入规划", "取消"])
def test_declining_the_preview_does_not_write_or_keep_confirmation(chat, message):
    chat["reply"](URL_A)
    chat["reply"]("好")
    chat["reply"](message)
    assert chat["count"]() == 0
    preview = chat["reply"]("好")
    assert chat["count"]() == 0
    assert "2026-10-05" in preview and "2026-10-06" in preview


def test_a_follow_up_question_containing_negative_words_is_not_a_cancellation(chat):
    chat["reply"](URL_A)
    chat["reply"]("好")
    assert chat["reply"]("这门课要不要先补基础？") == "正常回答"
    content = chat["payloads"][-1]["messages"][-1]["content"]
    assert "王道数据结构" in content and "目标「408」" in content
    assert chat["count"]() == 0
    chat["reply"]("确认")
    assert chat["count"]() == 2


@pytest.mark.parametrize("message", ["明天开始合适吗", "要按这个排吗？"])
def test_a_follow_up_question_is_not_a_date_or_schedule_confirmation(chat, message):
    chat["reply"](URL_A)
    chat["reply"]("好")
    assert chat["reply"](message) == "正常回答"
    assert chat["count"]() == 0
    chat["reply"]("确认")
    assert chat["count"]() == 2
