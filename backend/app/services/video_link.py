"""Open a link the user pasted, then fold what was actually on the page into the plan.

Bilibili watch pages are a shell, so those go through the public view API.
Any other http(s) page is read as HTML: title, description, headings, and a
short excerpt. Private and local addresses are refused.
"""

from __future__ import annotations

from datetime import date
from html.parser import HTMLParser
from urllib.parse import urlsplit
import ipaddress
import re
import socket
import uuid

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import ChatMessage, Conversation, DailyTask, Phase, Plan

_BVID = re.compile(r"BV[0-9A-Za-z]{10}")
_URL = re.compile(r"https?://[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+")
_BOUNDARY = set("，。、）】？！」")
_GLUED_TAIL = re.compile(r"(?:from|abc|P\d+)$")
_ADOPT = re.compile(
    r"按这个(视频|课程|系列|集|链接|内容)?(来)?学|就按这个|按这个排|合并到规划|加入规划|排进规划|按这个建议"
)
_YES = re.compile(r"^\s*(是的?|好的?|可以|行|要|嗯|同意)[，,。.!！\s]*$")
_VIEW = "https://api.bilibili.com/x/web-interface/view?bvid={bvid}"
_MAX_SECTIONS = 40
_MAX_BYTES = 400_000


def extract_bvid(text: str) -> str | None:
    match = _BVID.search(text or "")
    return match.group(0) if match else None


def _is_boundary(char: str) -> bool:
    return char.isspace() or ord(char) > 127 or char in _BOUNDARY


def _glued_ascii(url: str, nxt: str) -> bool:
    """True when ASCII text is stuck to a non-Bilibili URL and the end is a guess."""
    segment = re.split(r"[/?&=#.\-]", url)[-1]
    if _GLUED_TAIL.fullmatch(segment):
        return False
    if _GLUED_TAIL.search(segment):
        return True
    return bool(nxt and _is_boundary(nxt) and re.search(r"[A-Za-z]\d+$", segment))


def extract_url(text: str) -> str | None:
    raw = text or ""
    bvid = extract_bvid(raw)
    if bvid:
        return part_url(bvid, 1)
    match = _URL.search(raw)
    if not match:
        return None
    nxt = raw[match.end():match.end() + 1]
    if nxt and not _is_boundary(nxt):
        return None
    url = match.group(0).rstrip(".,;，。)")
    if _glued_ascii(url, nxt):
        return None
    return url


def wants_to_adopt(text: str) -> bool:
    raw = text or ""
    if extract_url(raw):
        return False
    return bool(_ADOPT.search(raw) or _YES.match(raw))


def part_url(bvid: str, page: int) -> str:
    if page <= 1:
        return f"https://www.bilibili.com/video/{bvid}"
    return f"https://www.bilibili.com/video/{bvid}?p={page}"


def public_http_url(value: str) -> str | None:
    """http(s) URL whose host does not resolve to a local or private address."""
    text = (value or "").strip()
    if not text or len(text) > 500 or any(char.isspace() for char in text):
        return None
    parts = urlsplit(text)
    host = parts.hostname
    if parts.scheme not in ("http", "https") or not host:
        return None
    if host.lower() in ("localhost",):
        return None
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return None
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return None
        if not ip.is_global:
            return None
    return text


def normalize_view(payload: dict, bvid: str) -> dict | None:
    if payload.get("code") != 0 or not isinstance(payload.get("data"), dict):
        return None
    data = payload["data"]
    page_url = f"https://www.bilibili.com/video/{bvid}"
    sections = []
    for item in (data.get("pages") or [])[:_MAX_SECTIONS]:
        if not isinstance(item, dict):
            continue
        try:
            number = int(item.get("page") or len(sections) + 1)
        except (TypeError, ValueError):
            number = len(sections) + 1
        part = str(item.get("part") or "").strip() or f"P{number}"
        try:
            seconds = int(item.get("duration") or 0)
        except (TypeError, ValueError):
            seconds = 0
        sections.append(
            {
                "label": f"P{number} {part}"[:80],
                "url": part_url(bvid, number),
                "duration": max(seconds, 0),
            }
        )
    title = str(data.get("title") or "未命名").strip()[:120]
    if not sections and title:
        try:
            seconds = int(data.get("duration") or 0)
        except (TypeError, ValueError):
            seconds = 0
        sections.append({"label": title[:80], "url": page_url, "duration": max(seconds, 0)})
    owner = data.get("owner") if isinstance(data.get("owner"), dict) else {}
    return {
        "url": page_url,
        "title": title,
        "source": str(owner.get("name") or "").strip()[:40],
        "summary": str(data.get("desc") or "").strip()[:400],
        "body": "",
        "sections": sections,
    }


class _PageText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.in_title = False
        self.title_parts: list[str] = []
        self.heading: list[str] | None = None
        self.headings: list[str] = []
        self.summary = ""
        self.chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {key.lower(): value or "" for key, value in attrs}
        if tag in ("script", "style", "noscript", "svg"):
            self.skip += 1
            return
        if tag == "title":
            self.in_title = True
        if tag in ("h1", "h2", "h3"):
            self.heading = []
        if tag == "meta" and not self.summary:
            name = (attr.get("name") or attr.get("property") or "").lower()
            if name in ("description", "og:description"):
                self.summary = attr.get("content", "")[:400]

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript", "svg") and self.skip:
            self.skip -= 1
            return
        if tag == "title":
            self.in_title = False
        if tag in ("h1", "h2", "h3") and self.heading is not None:
            text = " ".join(self.heading).strip()
            if text:
                self.headings.append(text[:80])
            self.heading = None

    def handle_data(self, data: str) -> None:
        if self.skip:
            return
        if self.in_title:
            self.title_parts.append(data)
        if self.heading is not None:
            self.heading.append(data)
        chunk = " ".join(data.split())
        if chunk:
            self.chunks.append(chunk)


def material_from_html(url: str, html: str) -> dict:
    parser = _PageText()
    parser.feed(html[:_MAX_BYTES])
    parser.close()
    title = " ".join(parser.title_parts).strip()[:120] or urlsplit(url).hostname or "这个链接"
    headings = []
    seen: set[str] = set()
    for heading in parser.headings:
        if heading in seen:
            continue
        seen.add(heading)
        headings.append(heading)
        if len(headings) >= _MAX_SECTIONS:
            break
    sections = [{"label": heading, "url": url, "duration": 0} for heading in headings]
    if not sections:
        sections = [{"label": title[:80], "url": url, "duration": 0}]
    body = " ".join(parser.chunks)[:2500]
    return {
        "url": url,
        "title": title,
        "source": urlsplit(url).hostname or "",
        "summary": parser.summary,
        "body": body,
        "sections": sections,
    }


async def fetch_link(url: str) -> dict | None:
    safe = public_http_url(url)
    if not safe:
        return None
    bvid = extract_bvid(safe)
    host = (urlsplit(safe).hostname or "").lower()
    referer = safe if safe.isascii() else "https://www.bilibili.com/"
    headers = {"User-Agent": "StudyPilot", "Referer": referer}
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            if bvid and host.endswith("bilibili.com"):
                response = await client.get(_VIEW.format(bvid=bvid), headers=headers)
                if response.status_code >= 400:
                    return None
                return normalize_view(response.json(), bvid)
            response = await client.get(safe, headers=headers)
            if response.status_code >= 400:
                return None
            kind = response.headers.get("content-type", "")
            if "html" not in kind and "text" not in kind and "json" not in kind:
                return None
            return material_from_html(safe, response.text[:_MAX_BYTES])
    except Exception:
        return None


def format_material(material: dict) -> str:
    lines = [
        f"链接：{material['url']}",
        f"标题：{material['title']}",
        f"来源：{material['source'] or '未知'}",
        f"摘要：{material['summary'] or '无'}",
    ]
    if material.get("body"):
        lines.append("正文摘录：" + material["body"])
    lines.append("页面里能排进每天的内容：")
    for section in material["sections"]:
        minutes = section["duration"] // 60
        suffix = f"（约{minutes}分钟）" if minutes else ""
        lines.append(f"{section['label']}{suffix}")
    return "\n".join(lines)


def study_brief(session: Session, user_id: uuid.UUID) -> str:
    plan = session.scalar(
        select(Plan).where(Plan.user_id == user_id).order_by(Plan.created_at.desc(), Plan.id.desc())
    )
    if plan is None:
        return "用户当前规划：还没有规划。"
    phase = session.scalar(
        select(Phase)
        .where(Phase.plan_id == plan.id, Phase.is_current.is_(True))
        .order_by(Phase.phase_index)
    )
    phase_text = "当前阶段未知"
    if phase is not None:
        phase_text = f"当前阶段「{phase.name}」{phase.start_date.isoformat()}到{phase.end_date.isoformat()}"
    return (
        f"用户当前规划：目标「{plan.goal_name}」，当前水平「{plan.current_level}」，"
        f"每天{plan.daily_minutes}分钟，目标日{plan.goal_date.isoformat()}。{phase_text}。"
    )


def latest_url(session: Session, user_id: uuid.UUID) -> str | None:
    rows = session.execute(
        select(ChatMessage.content)
        .join(Conversation, Conversation.id == ChatMessage.conversation_id)
        .where(Conversation.user_id == user_id, ChatMessage.role == "user")
        .order_by(ChatMessage.position.desc(), ChatMessage.id.desc())
        .limit(8)
    ).all()
    for (content,) in rows:
        found = extract_url(content or "")
        if found:
            return found
    return None


def _pack(sections: list[dict], daily_minutes: int) -> list[list[dict]]:
    budget = max(int(daily_minutes or 0), 20) * 60
    groups: list[list[dict]] = []
    current: list[dict] = []
    used = 0
    for section in sections:
        seconds = section["duration"] or budget
        if current and used + seconds > budget:
            groups.append(current)
            current = []
            used = 0
        current.append(section)
        used += seconds
    if current:
        groups.append(current)
    return groups


def merge_into_daily_plan(session: Session, user_id: uuid.UUID, material: dict) -> str:
    """Write this page's real sections onto pending tasks from today."""
    plan = session.scalar(
        select(Plan).where(Plan.user_id == user_id).order_by(Plan.created_at.desc(), Plan.id.desc())
    )
    if plan is None:
        return "还没有每日规划。先生成规划，再说按这个来学，我才能把链接里的内容排进每一天。"
    today = date.today()
    tasks = list(
        session.scalars(
            select(DailyTask)
            .where(
                DailyTask.plan_id == plan.id,
                DailyTask.task_date >= today,
                DailyTask.status == "pending",
            )
            .order_by(DailyTask.task_date, DailyTask.id)
        )
    )
    if not tasks:
        return "从今天起没有待完成的每日任务，所以还排不进去。先补上今天之后的任务。"
    marker = f"按《{material['title']}》学："
    if any(marker in task.description for task in tasks):
        return _schedule_reply(material, tasks, marker, already=True)
    groups = _pack(material["sections"], plan.daily_minutes)
    for index, group in enumerate(groups):
        task = tasks[min(index, len(tasks) - 1)]
        label = "、".join(section["label"] for section in group)
        if index < len(tasks):
            task.description = f"{task.description} {marker}{label}"
            link = public_http_url(group[0]["url"])
            if link:
                task.resource_url = link
        else:
            task.description = f"{task.description}、{label}"
    session.commit()
    return _schedule_reply(material, tasks[: min(len(groups), len(tasks))], marker, already=False)


def _schedule_reply(material: dict, tasks: list[DailyTask], marker: str, *, already: bool) -> str:
    head = (
        f"《{material['title']}》已经在每天的任务里。"
        if already
        else f"按你现在的规划，把《{material['title']}》里读到的内容排进从今天开始的每日任务了。"
    )
    lines = [head, "每天学到："]
    shown = tasks[:14]
    for task in shown:
        learned = task.description.split(marker, 1)[-1] if marker in task.description else task.description
        lines.append(f"{task.task_date.isoformat()} {learned}")
    hidden = len(tasks) - len(shown)
    if hidden > 0:
        lines.append(f"后面还有{hidden}天，打开路线图可以看完。")
    return "\n".join(lines)
