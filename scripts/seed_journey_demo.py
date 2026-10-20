#!/usr/bin/env python3
"""打印星藤航图的演示日程。

默认只打印，不写 data/*.json，也不连接数据库。
页面演示走前端 `#/journey?demo=1`，数据在 frontend/src/journey/mock.ts。
"""

from __future__ import annotations

import sys

ROWS = [
    ("2026-10-15", "1 星", "灰（未作答）", "完成 0/4"),
    ("2026-10-16", "2 星", "冷", "完成 2/5，阶段 Boss"),
    ("2026-10-17", "4 星", "鲜", "全清 4/4"),
    ("2026-10-18", "4 星", "暖", "全清 4/4，带顺延"),
    ("2026-10-19", "3 星", "暖", "今天 3/5，补强；再做 1 项得 4 星"),
    ("2026-10-20", "无", "花苞", "还没到，计划 4 项"),
    ("2026-10-21", "无", "芽", "没有任务"),
]


def main() -> int:
    if any(arg in {"--write", "--apply", "--seed-db"} for arg in sys.argv[1:]):
        print("这个脚本不写数据文件，也不改数据库。请打开 #/journey?demo=1。", file=sys.stderr)
        return 2
    print("星藤航图演示")
    print("计划：把数据讲清楚")
    print("日期：2026-07-22 → 2026-11-18，今天固定 2026-10-19")
    print("打开：#/journey?demo=1")
    print()
    for date, stars, color, note in ROWS:
        print(f"{date}  {stars:6}  {color:10}  {note}")
    print()
    print("未写入 data/*.json，也未连接数据库。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
