"""Open a link the user pasted, then fold what was actually on the page into the plan.

Bilibili watch pages are a shell, so those go through the public view API.
Any other http(s) page is read as HTML: title, description, headings, and a
short excerpt. Private and local addresses are refused.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from html.parser import HTMLParser
from urllib.parse import urlsplit
import ipaddress
import logging
import re
import socket
import uuid

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import ChatMessage, Conversation, DailyTask, Phase, Plan
from app.services import resource_links, task_service

_BVID = re.compile(r"BV[0-9A-Za-z]{10}")
_URL = re.compile(r"https?://(?:(?![,;)]https?://)[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%])+")
_BOUNDARY = set("，。、）】？！」,;)")
_ISO_DATE = re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)")
_CN_DATE = re.compile(r"(\d{1,2})月(\d{1,2})[日号]")
_DASH_DATE = re.compile(r"(?<!\d)(\d{1,2})-(\d{2})(?!\d)")
_ADOPT = re.compile(
    r"按这个(视频|课程|系列|集|链接|内容)?(来)?学|就按这个|按这个排|合并到规划|加入规划|排进规划|按这个建议"
)
_YES = re.compile(r"^\s*(是的?|好的?|可以|行|要|嗯|同意|确认(?:写入)?|确定)[，,。.!！\s]*$")
_VIEW = "https://api.bilibili.com/x/web-interface/view?bvid={bvid}"
# Headings scraped from one generic HTML page.
_MAX_SECTIONS = 40
# Parts of a single Bilibili video. Long courses run well past 100 parts, and
# anything dropped here disappears from both the reported duration and the
# daily plan, so this cap only guards against absurd input.
_MAX_VIDEO_SECTIONS = 300
# How many labels one line may list before it is cut short. The reply a reader
# sees stays short; the model is given more so it can judge what a course covers.
_MAX_LABELS_SHOWN = 8
_MAX_PROMPT_LABELS = 60
# How many parts ``format_material`` spells out for the model.
_MAX_MATERIAL_LINES = 60
_MAX_BYTES = 400_000
_logger = logging.getLogger(__name__)


def extract_bvid(text: str) -> str | None:
    match = _BVID.search(text or "")
    return match.group(0) if match else None


def _is_boundary(char: str) -> bool:
    return char.isspace() or ord(char) > 127 or char in _BOUNDARY


def _stuck_tail(text: str) -> str | None:
    """The text right after a link, when ASCII runs straight into the address.

    ``None`` means either there is no link, or the link ends cleanly — at
    whitespace, at a CJK character, at Chinese punctuation, or at the end of the
    message. A non-empty return is the only case where the address boundary
    would be a guess.
    """
    match = _URL.search(text or "")
    if match is None:
        return None
    tail = (text or "")[match.end():]
    if tail and not _is_boundary(tail[0]):
        return tail
    return None


def url_is_glued(text: str) -> bool:
    """True when ASCII text runs into a link, so its end cannot be trusted."""
    raw = text or ""
    if extract_bvid(raw):
        return False  # a BV id pins the address down exactly
    return _stuck_tail(raw) is not None


def extract_urls(text: str) -> list[str]:
    """Return distinct http(s) links and bare BV ids in message order.

    Bilibili addresses are rebuilt from their BV ids. Other addresses stay
    as written; ambiguous ASCII tails are refused, not guessed or trimmed.
    """
    raw = text or ""
    urls: list[str] = []
    for match in re.finditer(f"{_URL.pattern}|{_BVID.pattern}", raw):
        value = match.group(0)
        if value.startswith("BV"):
            url = part_url(value, 1)
        else:
            try:
                host = (urlsplit(value).hostname or "").lower()
            except ValueError:
                continue
            bvid = extract_bvid(value)
            if bvid and (host == "bilibili.com" or host.endswith(".bilibili.com")):
                url = part_url(bvid, 1)
            else:
                tail = raw[match.end():]
                if tail and not _is_boundary(tail[0]):
                    continue
                url = value.rstrip(".,;，。)")
        if url and url not in urls:
            urls.append(url)
    return urls


def extract_url(text: str) -> str | None:
    """Compatibility helper for callers that need only the first link."""
    urls = extract_urls(text)
    return urls[0] if urls else None


def _nearest_future(today: date, month: int, day: int) -> date | None:
    try:
        candidate = date(today.year, month, day)
    except ValueError:
        return None
    if candidate < today:
        try:
            return date(today.year + 1, month, day)
        except ValueError:
            return None
    return candidate


def parse_start_date(text: str, today: date) -> date | None:
    """Read a start day from a short reply. Unknown wording stays ``None``."""
    raw = text or ""
    iso = _ISO_DATE.search(raw)
    if iso:
        try:
            return date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
        except ValueError:
            return None
    cn = _CN_DATE.search(raw)
    if cn:
        return _nearest_future(today, int(cn.group(1)), int(cn.group(2)))
    dash = _DASH_DATE.search(raw)
    if dash:
        return _nearest_future(today, int(dash.group(1)), int(dash.group(2)))
    if "后天" in raw:
        return today + timedelta(days=2)
    if "明天" in raw or "明晚" in raw:
        return today + timedelta(days=1)
    if "今天" in raw:
        return today
    return None


def suggest_start(now: datetime) -> date:
    """At or after 20:00 the suggested day is tomorrow; otherwise today."""
    if now.hour >= 20:
        return now.date() + timedelta(days=1)
    return now.date()


def start_question(material: dict, daily_minutes: int, now: datetime) -> str:
    sections = material.get("sections") or []
    total = sum(int(section.get("duration") or 0) for section in sections)
    hours = round(total / 3600) if total else 0
    days = len(_pack(sections, daily_minutes))
    suggested = suggest_start(now)
    today = now.date()
    hour_text = f"合计约 {hours} 小时。" if hours else "合计时长还没读到。"
    return (
        f"我读到了《{material['title']}》，共 {len(sections)} 个分 P，{hour_text}\n"
        f"按你每天 {daily_minutes} 分钟算，大约要 {days} 天。\n"
        f"现在 {now:%H:%M}，从哪天开始？建议从 {suggested.isoformat()} 开始。\n"
        f"· 回「明天」→ {(today + timedelta(days=1)).isoformat()} 开始\n"
        f"· 回「今天」→ {today.isoformat()} 开始\n"
        f"· 也可以直接说日期，比如「10月8日」"
    )


def schedule_confirmation(material: dict, daily_minutes: int, start: date) -> str:
    days = len(_pack(material.get("sections") or [], daily_minutes))
    end = start + timedelta(days=max(days - 1, 0))
    return (
        f"即将把《{material['title']}》写入每日规划：\n"
        f"日期范围：{start.isoformat()} 至 {end.isoformat()}，共 {days} 天。\n"
        f"每天按 {daily_minutes} 分钟安排。尚未写入，回复「确认」后才写入。"
    )


def wants_to_adopt(text: str) -> bool:
    raw = text or ""
    if extract_url(raw) or re.search(r"不要|别|取消|不同意|不想|不需要|吗|[？?]|是否", raw):
        return False
    return bool(_ADOPT.search(raw) or _YES.match(raw))


def select_candidate(text: str, candidates: list[dict]) -> dict | None:
    """Only resolve a single, explicit choice; questions are not selections."""
    raw = (text or "").strip()
    if re.search(r"吗|？|\?|哪个|哪门|还是|适合|是否|不要|不选|别选", _URL.sub("", raw)):
        return None
    urls = extract_urls(raw)
    if urls:
        matches = [item for item in candidates if item["url"] in urls]
        return matches[0] if len(urls) == 1 and len(matches) == 1 else None
    named = [
        item for item in candidates
        if raw in (
            (item.get("material") or {}).get("title"),
            (item.get("material") or {}).get("source"),
        )
    ]
    if named:
        return named[0] if len(named) == 1 else None
    if not re.search(r"选|就用|就学|就按", raw) and not re.fullmatch(
        r"第?[一二三四五六七八九十\d]+个|[A-Za-z]", raw
    ):
        return None
    numbers = {char: index for index, char in enumerate("一二三四五六七八九十", 1)}
    ordinals = {
        int(value) if value.isascii() else numbers.get(value)
        for value in re.findall(r"第?([一二三四五六七八九十\d]+)个", raw)
    }
    matches = []
    for index, item in enumerate(candidates, 1):
        if index in ordinals or (index <= 26 and re.search(
            rf"(?<![A-Za-z])[{chr(64 + index)}{chr(96 + index)}](?![A-Za-z])", raw
        )):
            matches.append(item)
            continue
        material = item.get("material") or {}
        names = [
            name for name in (material.get("title"), material.get("source")) if name
        ]
        if any(name in raw for name in names):
            matches.append(item)
    return matches[0] if len(matches) == 1 else None


def _format_duration(seconds: int) -> str:
    """Long courses read better in hours; short clips stay in minutes."""
    minutes = round(seconds / 60)
    if seconds >= 3600:
        return f"{seconds / 3600:.1f} 小时（{minutes} 分钟）"
    return f"{minutes} 分钟"


def _display_labels(
    labels: list[str], separator: str = "、", limit: int = _MAX_LABELS_SHOWN
) -> str:
    """Join labels for display, cutting a long list short.

    A full part list can run to a hundred entries; spelling every one out turns
    a reply into a wall of text. The count is always stated so nothing is
    hidden — only abbreviated.
    """
    if len(labels) <= limit:
        return separator.join(labels)
    head = separator.join(labels[:limit])
    return f"{head}{separator}…（共 {len(labels)} 节）"


def format_comparison(candidates: list[dict], *, for_model: bool = False) -> str:
    """Compare fetched facts without inferring unseen topics or quality.

    ``for_model`` keeps more of the outline. The model needs enough of it to
    judge what each course actually covers; a reply shown to the reader stays
    short instead.
    """
    label_limit = _MAX_PROMPT_LABELS if for_model else _MAX_LABELS_SHOWN
    complete_totals = []
    for item in candidates:
        sections = (item.get("material") or {}).get("sections") or []
        if sections and all(section.get("duration", 0) > 0 for section in sections):
            complete_totals.append(sum(section["duration"] for section in sections))
    lines = ["按实际读到的内容逐个对比："]
    for index, item in enumerate(candidates, 1):
        material = item.get("material")
        if not material:
            lines.extend(
                (
                    f"{index}. {item['url']}",
                    "这个没读到。章节结构、时长、覆盖范围和来源都无法核实，不能判断优劣或排进规划。",
                )
            )
            continue
        sections = material.get("sections") or []
        labels = [
            str(section.get("label") or "") for section in sections
        ] if material.get("has_outline", True) else []
        total = sum(int(section.get("duration") or 0) for section in sections)
        unknown = sum(not section.get("duration") for section in sections)
        duration = _format_duration(total)
        if not total:
            duration = "没读到，不能估算总时长"
        elif unknown:
            duration = f"已知部分 {duration}，另有 {unknown} 节没读到时长，不能当作总时长"
        coverage = material.get("summary") or material.get("body")
        if not coverage:
            coverage = (
                "只读到目录：" + _display_labels(labels, limit=label_limit)
                if labels else f"只读到标题：{material['title']}"
            )
        source = material.get("source") or "没读到"
        lines.extend(
            (
                f"{index}. 《{material['title']}》",
                f"链接：{item['url']}",
                f"章节结构：共读到 {len(sections)} 节；"
                + _display_labels(labels, " → ", limit=label_limit)
                if labels else "章节结构：没读到章节目录，仅有标题。",
                f"时长（已读章节）：{duration}",
                f"覆盖范围（页面摘要、正文或目录）：{coverage}",
                f"来源：{source}",
                "优势：",
                f"1）读到的目录可按章节安排学习：{_display_labels(labels, limit=label_limit)}。"
                if labels else "1）读到了标题，但尚无章节依据。",
            )
        )
        advantage_number = 2
        other_labels = {
            re.sub(r"^P\d+\s*", "", str(section.get("label") or ""))
            for other in candidates if other is not item and other.get("material")
            and other["material"].get("has_outline", True)
            for section in other["material"].get("sections") or []
        }
        distinct = [
            label for label in labels if re.sub(r"^P\d+\s*", "", label) not in other_labels
        ]
        if other_labels and distinct:
            lines.append(
                f"{advantage_number}）目录区别：这份明确列出"
                f"{_display_labels(distinct, limit=label_limit)}，"
                "其他已读取目录未列出，便于按这些章节选课；不代表其他课程没讲。"
            )
            advantage_number += 1
        if (
            not unknown and total and len(complete_totals) > 1
            and total == min(complete_totals) < max(complete_totals)
        ):
            lines.append(
                f"{advantage_number}）相较其他已读到时长的资料，"
                "已读章节合计更短，学习这些章节所需时间更少。"
            )
        lines.append("劣势与限制：")
        if unknown or not total:
            lines.append("1）没读到完整时长，无法与其他资料比较总学习投入。")
        elif (
            len(complete_totals) > 1
            and total == max(complete_totals) > min(complete_totals)
        ):
            lines.append("1）相较其他已读到时长的资料，已读章节合计更长，需要更多学习时间。")
        else:
            lines.append("1）时长不能证明讲解深度，不能据此认定课程质量更好。")
        lines.append("2）覆盖范围只限已读到的内容，不能确认是否完整覆盖考试；目录未列出不代表没讲。")
        if not material.get("source"):
            lines.append("3）来源没读到，无法核实讲授者。")
    lines.append("请明确选择一个，比如「选第一个」「选第二个」或发送选定的链接。选定前不会写入规划。")
    return "\n".join(lines)


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
    except socket.gaierror as error:
        _logger.warning("Study link DNS lookup failed: host=%s error=%s", host, error)
        return None
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return None
        if not ip.is_global:
            _logger.warning("Study link DNS address rejected: host=%s address=%s", host, ip)
            return None
    return text


def normalize_view(payload: dict, bvid: str) -> dict | None:
    if payload.get("code") != 0 or not isinstance(payload.get("data"), dict):
        return None
    data = payload["data"]
    page_url = f"https://www.bilibili.com/video/{bvid}"
    sections = []
    for item in (data.get("pages") or [])[:_MAX_VIDEO_SECTIONS]:
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
    has_outline = bool(sections)
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
        "has_outline": has_outline,
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
        "has_outline": bool(headings),
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
                    _logger.warning(
                        "Bilibili metadata request failed: bvid=%s status=%s",
                        bvid, response.status_code,
                    )
                    return None
                payload = response.json()
                material = normalize_view(payload, bvid)
                if material is None:
                    _logger.warning(
                        "Bilibili metadata rejected: bvid=%s code=%s",
                        bvid, payload.get("code"),
                    )
                return material
            response = await client.get(safe, headers=headers)
            if response.status_code >= 400:
                return None
            kind = response.headers.get("content-type", "")
            if "html" not in kind and "text" not in kind and "json" not in kind:
                return None
            return material_from_html(safe, response.text[:_MAX_BYTES])
    except Exception:
        _logger.warning("Study link fetch failed: host=%s bvid=%s", host, bvid, exc_info=True)
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
    sections = material["sections"]
    for section in sections[:_MAX_MATERIAL_LINES]:
        minutes = section["duration"] // 60
        suffix = f"（约{minutes}分钟）" if minutes else ""
        lines.append(f"{section['label']}{suffix}")
    hidden = len(sections) - _MAX_MATERIAL_LINES
    if hidden > 0:
        lines.append(f"（后面还有 {hidden} 节，没有全部列出）")
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
        found = extract_urls(content or "")
        if found:
            # Comparison history is not permission to choose its first link.
            return found[0] if len(found) == 1 else None
    return None


def _pack(sections: list[dict], daily_minutes: int) -> list[list[dict]]:
    """Split each part into day-sized slices, then fill consecutive days."""
    budget = max(int(daily_minutes or 0), 20) * 60
    pieces: list[dict] = []
    for section in sections:
        remaining = int(section.get("duration") or 0) or budget
        part_total = max(1, (remaining + budget - 1) // budget)
        index = 1
        while remaining > 0:
            take = min(remaining, budget)
            label = str(section.get("label") or "")
            if part_total > 1:
                label = f"{label}（{index}/{part_total}）"
            pieces.append(
                {
                    "label": label,
                    "url": section.get("url") or "",
                    "seconds": take,
                    "part_index": index,
                    "part_total": part_total,
                }
            )
            remaining -= take
            index += 1
    groups: list[list[dict]] = []
    current: list[dict] = []
    used = 0
    for piece in pieces:
        if current and used + piece["seconds"] > budget:
            groups.append(current)
            current = []
            used = 0
        current.append(piece)
        used += piece["seconds"]
    if current:
        groups.append(current)
    return groups


def _phase_for_day(session: Session, plan_id: uuid.UUID, day: date) -> Phase | None:
    phase = session.scalar(
        select(Phase)
        .where(
            Phase.plan_id == plan_id,
            Phase.start_date <= day,
            Phase.end_date >= day,
        )
        .order_by(Phase.phase_index)
    )
    if phase is not None:
        return phase
    phase = session.scalar(
        select(Phase)
        .where(Phase.plan_id == plan_id, Phase.is_current.is_(True))
        .order_by(Phase.phase_index)
    )
    if phase is not None:
        return phase
    return session.scalar(
        select(Phase).where(Phase.plan_id == plan_id).order_by(Phase.phase_index)
    )


def _strip_marker(session: Session, plan_id: uuid.UUID, marker: str) -> None:
    tasks = list(session.scalars(select(DailyTask).where(DailyTask.plan_id == plan_id)))
    for task in tasks:
        if marker not in task.description:
            continue
        head = task.description.split(marker, 1)[0].rstrip()
        if not head:
            session.delete(task)
            continue
        task.description = head
        task.resource_url = None
    session.flush()


def merge_into_daily_plan(
    session: Session,
    user_id: uuid.UUID,
    material: dict,
    start_date: date,
) -> str:
    """Lay this page's sections on consecutive days starting at ``start_date``."""
    plan = session.scalar(
        select(Plan).where(Plan.user_id == user_id).order_by(Plan.created_at.desc(), Plan.id.desc())
    )
    if plan is None:
        return "还没有每日规划。先生成规划，再说按这个来学，我才能把链接里的内容排进每一天。"
    marker = f"按《{material['title']}》学："
    _strip_marker(session, plan.id, marker)
    groups = _pack(material["sections"], plan.daily_minutes)
    written: list[DailyTask] = []
    touched: set[uuid.UUID] = set()
    for index, group in enumerate(groups):
        target = start_date + timedelta(days=index)
        task = session.scalar(
            select(DailyTask)
            .where(
                DailyTask.plan_id == plan.id,
                DailyTask.task_date == target,
                DailyTask.status == "pending",
            )
            .order_by(DailyTask.id)
        )
        label = "、".join(piece["label"] for piece in group)
        # Store the part's own address, validated against the platform
        # allow-list. ``public_http_url`` is for *fetching* (it resolves DNS to
        # block private hosts) and must not be used here — a write path must not
        # depend on the network, and a DNS hiccup would silently drop the link.
        link = resource_links.sanitize_resource_url(group[0]["url"])
        if task is None:
            phase = _phase_for_day(session, plan.id, target)
            if phase is None:
                return "这份规划还没有阶段，排不进每日任务。"
            task = DailyTask(
                plan_id=plan.id,
                phase_id=phase.id,
                task_date=target,
                week_label=f"W{target.isocalendar().week:02d}",
                description=f"{marker}{label}",
                status="pending",
                resource_url=link,
            )
            session.add(task)
            touched.add(phase.id)
        else:
            task.description = f"{task.description} {marker}{label}"
            if link:
                task.resource_url = link
            touched.add(task.phase_id)
        written.append(task)
    session.flush()
    for phase_id in touched:
        phase = session.get(Phase, phase_id)
        if phase is not None:
            task_service.recompute_phase_progress(session, phase)
    session.commit()
    return _schedule_reply(material, written, marker, start_date)


def _schedule_reply(
    material: dict, tasks: list[DailyTask], marker: str, start_date: date
) -> str:
    head = (
        f"按你现在的规划，把《{material['title']}》里读到的内容"
        f"排进从{start_date.isoformat()}开始的每日任务了。"
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
