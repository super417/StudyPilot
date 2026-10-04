"""Host-whitelisted public study links for daily tasks.

Product stance (see ``DEPLOY.md``): StudyPilot never invents addresses. A model
may name real public platforms, but a URL it returns is only persisted when its
host is on the curated allow-list below. Anything else is dropped while the task
description survives — a task without a link is fine, a task pointing at a
made-up page is not.

The allow-list holds platform domains, not deep paths. A course page under
``bilibili.com`` is accepted; ``bilibili.com.evil.example`` is not, because
matching is on label boundaries only.
"""

from __future__ import annotations

from urllib.parse import urlsplit

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
    parts = urlsplit(text)
    if parts.scheme not in ("http", "https"):
        return None
    if not is_allowed_host(parts.hostname or ""):
        return None
    return text
