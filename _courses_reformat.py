"""Reformat courses.json to match HEAD style. Not product code."""
import json
from pathlib import Path


def dumps(obj, indent=0):
    pad = "  " * indent
    pad1 = "  " * (indent + 1)

    if isinstance(obj, dict):
        if not obj:
            return "{}"
        is_course = "course_id" in obj
        parts = []
        for key, value in obj.items():
            if key == "prereq" and isinstance(value, list) and all(
                isinstance(x, str) for x in value
            ):
                parts.append(f'{pad1}"{key}": {json.dumps(value, ensure_ascii=False)}')
            elif (
                key == "skills"
                and is_course
                and isinstance(value, list)
                and all(isinstance(x, str) for x in value)
            ):
                parts.append(f'{pad1}"{key}": {json.dumps(value, ensure_ascii=False)}')
            elif key == "sources" and isinstance(value, list) and all(
                isinstance(x, dict) for x in value
            ):
                lines = [f'{pad1}"{key}": [']
                for i, item in enumerate(value):
                    comma = "," if i < len(value) - 1 else ""
                    lines.append(
                        f"{pad1}  {json.dumps(item, ensure_ascii=False)}{comma}"
                    )
                lines.append(f"{pad1}]")
                parts.append("\n".join(lines))
            elif (
                key in {"skills", "sections"}
                and isinstance(value, list)
                and all(isinstance(x, str) for x in value)
            ):
                # direction.skills and chapter.sections: one string per line (HEAD)
                if not value:
                    parts.append(f'{pad1}"{key}": []')
                else:
                    lines = [f'{pad1}"{key}": [']
                    for i, item in enumerate(value):
                        comma = "," if i < len(value) - 1 else ""
                        lines.append(
                            f"{pad1}  {json.dumps(item, ensure_ascii=False)}{comma}"
                        )
                    lines.append(f"{pad1}]")
                    parts.append("\n".join(lines))
            else:
                parts.append(f'{pad1}"{key}": {dumps(value, indent + 1)}')
        return "{\n" + ",\n".join(parts) + f"\n{pad}}}"

    if isinstance(obj, list):
        if not obj:
            return "[]"
        if all(isinstance(x, dict) for x in obj):
            parts = [dumps(x, indent + 1) for x in obj]
            body = ",\n".join(f"{pad1}{p}" for p in parts)
            return f"[\n{body}\n{pad}]"
        return json.dumps(obj, ensure_ascii=False)

    return json.dumps(obj, ensure_ascii=False)


def main() -> None:
    data = json.loads(Path("data/courses.json").read_text(encoding="utf-8"))

    removed = []
    for direction in data["directions"]:
        before = [c["course_id"] for c in direction["courses"]]
        direction["courses"] = [
            c for c in direction["courses"] if c.get("course_id") != "ai-edu-004"
        ]
        after = [c["course_id"] for c in direction["courses"]]
        if before != after:
            removed.append((direction["id"], [x for x in before if x not in after]))

    text = dumps(data) + "\n"
    # HEAD puts a blank line after meta block before "directions"
    text = text.replace(
        '  },\n  "directions":',
        '  },\n\n  "directions":',
        1,
    )
    Path("data/courses.json").write_text(text, encoding="utf-8")
    json.loads(text)
    ids = [c["course_id"] for d in data["directions"] for c in d["courses"]]
    print("removed", removed)
    print("ids", ids)
    print("lines", text.count("\n") + 1)


if __name__ == "__main__":
    main()
