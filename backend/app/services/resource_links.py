"""Concrete public resource pages. Path validation does not prove page content."""

from __future__ import annotations

import re
from urllib.parse import unquote, urlsplit

# Matches the ``daily_tasks.resource_url`` column width.
URL_MAX = 500

# Curated public study platforms. ``edu.cn`` / ``ac.cn`` admit Chinese
# university and research-institute hosts as subdomains.
ALLOWED_RESOURCE_HOSTS = frozenset(
    {
        "bilibili.com",
        "icourse163.org",
        "xuetangx.com",
        "zhihuishu.com",
        "chaoxing.com",
        "open.163.com",
        "coursera.org",
        "zhihu.com",
        "kaoyan.com",
        "kaoyan365.cn",
        "exam8.com",
        "koolearn.com",
        "chsi.com.cn",
        "edu.cn",
        "ac.cn",
        "mit.edu",
        # 国家高等教育智慧教育平台 / 人民邮电出版社 MOOC（15b 扩名单）
        "smartedu.cn",
        "rymooc.com",
    }
)


def is_allowed_host(host: str) -> bool:
    """True when ``host`` is an allow-listed domain or a subdomain of one."""
    name = (host or "").strip().lower().rstrip(".")
    if not name:
        return False
    return any(
        name == allowed or name.endswith("." + allowed)
        for allowed in ALLOWED_RESOURCE_HOSTS
    )


def sanitize_resource_url(value: object) -> str | None:
    """Return the URL unchanged when it is a trustworthy public link.

    ``None`` covers every rejection: empty, over-long, whitespace-containing,
    a non-HTTP scheme, or a host outside :data:`ALLOWED_RESOURCE_HOSTS`.
    """
    text = "" if value is None else str(value).strip()
    if not text or len(text) > URL_MAX or any(char.isspace() for char in text):
        return None
    try:
        parts = urlsplit(text)
        host = parts.hostname or ""
        port = parts.port
    except ValueError:
        return None
    if parts.scheme not in ("http", "https"):
        return None
    if not is_allowed_host(host) or parts.username or parts.password or port not in (None, 80, 443):
        return None
    path = unquote(parts.path)
    if any(segment in (".", "..") for segment in path.split("/")) or "\\" in path:
        return None
    if host.lower().rstrip(".") == "bilibili.com" or host.lower().rstrip(".").endswith(".bilibili.com"):
        concrete = re.fullmatch(r"/video/(?:BV[0-9A-Za-z]+|av[0-9]+)/?", path)
    else:
        concrete = re.fullmatch(r"/(?:video|course|courses|training|courseHome|learn|lecture|lesson)/[^/]+(?:/[^/]+)*/?", path)
    return text if concrete else None
