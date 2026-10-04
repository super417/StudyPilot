from datetime import date, datetime, timedelta, timezone

# 中国全境单一时区、无夏令时，固定 +8 即可，不需要 tzdata。
CHINA_TZ = timezone(timedelta(hours=8))


def local_now() -> datetime:
    return datetime.now(CHINA_TZ)


def local_today() -> date:
    return local_now().date()
