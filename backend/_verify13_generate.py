"""临时验证：直接调 /api/practice/generate，检查 sourceRefs。非产品代码。"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8000"
ROOT = Path(__file__).resolve().parent
TOKEN_FILE = ROOT / ".verify_token"
SESSIONS_FILE = ROOT / ".sessions.json"
SUPER_PREFIX = "4c6d1df3"
TIMEOUT = 40


def resolve_token() -> str:
    if TOKEN_FILE.exists():
        token = TOKEN_FILE.read_text(encoding="utf-8").strip()
        if token:
            return token
    if not SESSIONS_FILE.exists():
        raise SystemExit(f"缺少 {SESSIONS_FILE.name}，且无 {TOKEN_FILE.name}")
    sessions = json.loads(SESSIONS_FILE.read_text(encoding="utf-8"))
    candidates: list[tuple[str, str]] = []
    for token, meta in sessions.items():
        if not isinstance(meta, dict):
            continue
        uid = str(meta.get("user_id", ""))
        if uid.startswith(SUPER_PREFIX):
            last = str(meta.get("last_active_at") or "")
            candidates.append((last, token))
    if not candidates:
        raise SystemExit(f".sessions.json 中无 user_id 前缀 {SUPER_PREFIX} 的会话")
    candidates.sort(key=lambda x: x[0], reverse=True)
    token = candidates[0][1]
    TOKEN_FILE.write_text(token, encoding="utf-8")
    print(f"已写入 {TOKEN_FILE.name}（最新 last_active_at={candidates[0][0]!r}）")
    return token


def post_generate(token: str) -> tuple[int, str]:
    body = json.dumps({"date": "2026-10-17"}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}/api/practice/generate",
        data=body,
        headers={
            "Cookie": f"studypilot_session={token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")
    except TimeoutError as e:
        raise SystemExit(f"请求超时（{TIMEOUT}s）: {e}") from e
    except urllib.error.URLError as e:
        raise SystemExit(f"请求失败: {e}") from e


def main() -> None:
    token = resolve_token()
    status, raw = post_generate(token)

    if status >= 400:
        print(f"HTTP {status}")
        print(raw[:500])
        raise SystemExit(1)

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        print(f"HTTP {status}")
        print(raw[:500])
        raise SystemExit(1)

    print(json.dumps(payload, indent=2, ensure_ascii=False))

    questions = payload.get("questions") if isinstance(payload, dict) else None
    with_refs = 0
    without_refs = 0
    if isinstance(questions, list):
        for i, q in enumerate(questions):
            if not isinstance(q, dict):
                print(f"[Q{i}] sourceRefs: null or missing")
                without_refs += 1
                continue
            if "sourceRefs" not in q:
                print(f"[Q{i}] sourceRefs: null or missing")
                without_refs += 1
                continue
            refs = q.get("sourceRefs")
            if refs is None or refs == []:
                print(f"[Q{i}] sourceRefs: null or missing")
                without_refs += 1
                continue
            with_refs += 1
            first = refs[0] if isinstance(refs, list) and refs else {}
            filename = first.get("filename")
            chunk_index = first.get("chunkIndex")
            snippet = first.get("snippet")
            snippet_preview = (snippet[:60] if isinstance(snippet, str) else snippet)
            print(
                f"[Q{i}] sourceRefs ok | filename={filename!r} "
                f"chunkIndex={chunk_index!r} snippet={snippet_preview!r}"
            )

        total = len(questions)
        print(
            f"\n总结：生成了 {total} 道题，"
            f"{with_refs} 道有出处，{without_refs} 道没有出处"
        )
    else:
        print("\n总结：响应中无 questions 数组")


if __name__ == "__main__":
    main()
