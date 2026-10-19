"""Splice semantic course edits onto HEAD text to kill format noise. Not product code."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path


def extract_course_blocks(text: str) -> dict[str, str]:
    """Map course_id -> exact source substring of that course object (no trailing comma)."""
    blocks: dict[str, str] = {}
    for match in re.finditer(r'"course_id"\s*:\s*"([^"]+)"', text):
        cid = match.group(1)
        # walk left to the opening brace of this course object
        i = match.start()
        while i > 0 and text[i] != "{":
            i -= 1
        if text[i] != "{":
            raise RuntimeError(f"no opening brace for {cid}")
        depth = 0
        j = i
        while j < len(text):
            ch = text[j]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    blocks[cid] = text[i : j + 1]
                    break
            j += 1
        else:
            raise RuntimeError(f"unclosed course {cid}")
    return blocks


def dumps_course(course: dict) -> str:
    """Format one course object close to HEAD style."""
    lines: list[str] = ["        {"]
    order = [
        "course_id",
        "name",
        "institution",
        "provider",
        "instructor",
        "url",
        "url_verified",
        "hours",
        "level",
        "prereq",
        "skills",
        "verified",
        "verified_note",
        "source_url",
        "collected_at",
        "chapters",
    ]
    for key in order:
        if key not in course:
            continue
        value = course[key]
        if key in {"prereq", "skills"}:
            lines.append(f'          "{key}": {json.dumps(value, ensure_ascii=False)},')
        elif key == "chapters":
            lines.append('          "chapters": [')
            for ci, ch in enumerate(value):
                comma = "," if ci < len(value) - 1 else ""
                sections = ch.get("sections") or []
                sec_json = json.dumps(sections, ensure_ascii=False)
                # compact one-liner when short / empty (HEAD style)
                if len(sec_json) <= 80:
                    lines.append(
                        "            "
                        + json.dumps(
                            {
                                "index": ch["index"],
                                "title": ch["title"],
                                "sections": sections,
                            },
                            ensure_ascii=False,
                        )
                        + comma
                    )
                else:
                    lines.append("            {")
                    lines.append(f'              "index": {ch["index"]},')
                    lines.append(
                        f'              "title": {json.dumps(ch["title"], ensure_ascii=False)},'
                    )
                    lines.append("              \"sections\": [")
                    for si, sec in enumerate(sections):
                        sc = "," if si < len(sections) - 1 else ""
                        lines.append(
                            f"                {json.dumps(sec, ensure_ascii=False)}{sc}"
                        )
                    lines.append("              ]")
                    lines.append(f"            }}{comma}")
            lines.append("          ]")
        else:
            rendered = json.dumps(value, ensure_ascii=False)
            # trailing comma except last field before chapters handled above;
            # chapters is last → no comma on chapters closing already.
            if key == "collected_at":
                lines.append(f'          "{key}": {rendered},')
            else:
                lines.append(f'          "{key}": {rendered},')
    # fix: collected_at has comma then chapters; last chapter block has no trailing on course
    # Remove trailing comma from last non-chapters line if chapters missing — chapters always present.
    return "\n".join(lines) + "\n        }"


def main() -> None:
    head_text = subprocess.check_output(
        ["git", "show", "HEAD:data/courses.json"], text=True, encoding="utf-8"
    )
    head = json.loads(head_text)
    cur = json.loads(Path("data/courses.json").read_text(encoding="utf-8"))
    head_blocks = extract_course_blocks(head_text)

    head_ids = {c["course_id"] for d in head["directions"] for c in d["courses"]}
    cur_by_id = {c["course_id"]: c for d in cur["directions"] for c in d["courses"]}
    # Desired final set (already without ai-edu-004 in current file)
    desired_ids = set(cur_by_id)

    deleted = sorted(head_ids - desired_ids)
    added = sorted(desired_ids - head_ids)
    changed = sorted(
        cid
        for cid in (head_ids & desired_ids)
        if next(c for d in head["directions"] for c in d["courses"] if c["course_id"] == cid)
        != cur_by_id[cid]
    )
    print("deleted", deleted)
    print("added", added)
    print("changed", changed)

    # Rebuild directions from HEAD order, applying edits.
    # Keep HEAD direction wrappers; rebuild courses arrays as formatted text.
    out_dirs: list[str] = []
    # Split head into direction course-list regions via course order in each direction
    # Easier: dump whole file from structured data but reuse HEAD block text for SAME courses.

    def format_courses_array(course_ids: list[str]) -> str:
        parts: list[str] = []
        for i, cid in enumerate(course_ids):
            comma = "," if i < len(course_ids) - 1 else ""
            if cid in head_blocks and cid not in changed and cid not in added:
                block = head_blocks[cid]
            else:
                block = dumps_course(cur_by_id[cid])
            parts.append(block + comma)
        return "\n".join(parts)

    # Reconstruct full file: take HEAD, replace each direction's courses array body.
    # Find `"courses": [` ... matching close at direction level.
    result = head_text
    # Process from end to start so offsets stay valid — rebuild from JSON instead.

    # Build new JSON structure for course lists
    new_data = json.loads(head_text)
    # map direction id -> desired course ids from cur (preserve cur order)
    cur_dir_courses = {
        d["id"]: [c["course_id"] for c in d["courses"]] for d in cur["directions"]
    }
    for direction in new_data["directions"]:
        ids = cur_dir_courses[direction["id"]]
        direction["courses"] = [cur_by_id[cid] for cid in ids]

    # Now serialize by replacing course blocks in a template built from HEAD meta+directions shell
    # Manual assembly:
    # find start of directions array content
    meta_end = result.find('"directions"')
    prefix = result[: meta_end]

    dir_chunks: list[str] = []
    for di, direction in enumerate(new_data["directions"]):
        # extract direction header from HEAD (from direction opening to "courses": [)
        dir_id = direction["id"]
        # locate in HEAD text
        marker = f'"id": "{dir_id}"'
        pos = head_text.find(marker)
        if pos < 0:
            raise RuntimeError(dir_id)
        # walk left to brace
        i = pos
        while i > 0 and head_text[i] != "{":
            i -= 1
        courses_key = head_text.find('"courses"', i)
        courses_bracket = head_text.find("[", courses_key)
        header = head_text[i : courses_bracket + 1]  # includes [
        # find end of courses array
        depth = 0
        j = courses_bracket
        while j < len(head_text):
            if head_text[j] == "[":
                depth += 1
            elif head_text[j] == "]":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        # after courses array, rest of direction object until its closing brace
        # HEAD has `]\n      }\n` or with comma
        k = j + 1
        # include closing `}` of direction
        while k < len(head_text) and head_text[k] != "}":
            k += 1
        footer = head_text[j + 1 : k + 1]  # from after ] through }
        ids = [c["course_id"] for c in direction["courses"]]
        body = format_courses_array(ids)
        chunk = header + "\n" + body + "\n" + footer
        # ensure proper comma between directions later
        dir_chunks.append(chunk)

    dirs_joined = ",\n    ".join(dir_chunks)
    final = prefix + '"directions": [\n    ' + dirs_joined + "\n  ]\n}\n"
    Path("_courses_splice_out.json").write_text(final, encoding="utf-8")
    try:
        parsed = json.loads(final)
    except json.JSONDecodeError as exc:
        print("JSON error", exc)
        # show context around error
        line_no = exc.lineno
        rows = final.splitlines()
        start = max(0, line_no - 8)
        end = min(len(rows), line_no + 8)
        for n in range(start, end):
            mark = ">>" if n + 1 == line_no else "  "
            print(f"{mark}{n+1}: {rows[n]}")
        raise
    Path("data/courses.json").write_text(final, encoding="utf-8")
    ids = [c["course_id"] for d in parsed["directions"] for c in d["courses"]]
    print("final ids", ids)
    print("lines", final.count("\n") + 1)


if __name__ == "__main__":
    main()
