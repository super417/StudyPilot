#!/usr/bin/env python3
"""查看 StudyPilot 用户流程模拟的 JSONL 历史报告。"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent if (SCRIPT_DIR.parent / '.ai-handoff' / 'demo-materials').is_dir() else SCRIPT_DIR
DEFAULT_REPORT = ROOT / ".ai-handoff" / "user-flow-reports.jsonl"


def read_reports(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    reports = []
    with path.open("r", encoding="utf-8-sig") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                print(f"警告：跳过第 {line_number} 行无效 JSON", file=sys.stderr)
                continue
            if isinstance(item, dict):
                reports.append(item)
    return reports


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=10, help="显示最近 N 次，默认 10")
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT, help="JSONL 报告路径")
    parser.add_argument("--json", action="store_true", help="以 JSON 数组输出")
    args = parser.parse_args()
    if args.limit < 1:
        parser.error("--limit 必须大于 0")

    reports = read_reports(args.report)
    if not reports:
        print(f"暂无执行报告：{args.report}")
        return 1

    selected = reports[-args.limit :]
    if args.json:
        print(json.dumps(selected, ensure_ascii=False, indent=2))
        return 0

    print(f"报告文件：{args.report}")
    print(f"共 {len(reports)} 次执行；显示最近 {len(selected)} 次")
    labels = {"success": "成功", "partial": "部分成功", "failed": "失败"}
    for report in reversed(selected):
        steps = report.get("steps") or []
        failed = [step for step in steps if step.get("status") == "failed"]
        status = labels.get(str(report.get("status")), "失败")
        print(
            f"\n[{report.get('startedAt', '未知时间')}] {status} "
            f"runId={report.get('runId', '未知')} "
            f"耗时={report.get('durationMs', 0)} ms 步骤={len(steps)}"
        )
        if report.get("retries"):
            print(f"  重试：{len(report['retries'])} 次")
        if failed:
            for step in failed:
                tag = "非关键" if step.get("optional") else "关键"
                print(f"  失败步骤（{tag}）：{step.get('name')} — {step.get('error')}")
            if report.get("error"):
                print(f"  错误：{report['error']}")
        elif report.get("error"):
            print(f"  错误：{report['error']}")
        else:
            print(f"  完成步骤：{sum(step.get('status') == 'success' for step in steps)}/{len(steps)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
