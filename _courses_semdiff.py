"""One-shot semantic diff for courses.json. Not product code."""
import json
import subprocess
from pathlib import Path

head = json.loads(
    subprocess.check_output(
        ["git", "show", "HEAD:data/courses.json"], text=True, encoding="utf-8"
    )
)
cur = json.loads(Path("data/courses.json").read_text(encoding="utf-8"))


def courses_by_id(data):
    out = {}
    for d in data["directions"]:
        for c in d["courses"]:
            out[c["course_id"]] = (d["id"], c)
    return out


h = courses_by_id(head)
c = courses_by_id(cur)
lines = []
lines.append(f"HEAD courses {len(h)} CUR courses {len(c)}")
lines.append(f"deleted {sorted(set(h) - set(c))}")
lines.append(f"added {sorted(set(c) - set(h))}")

url_verified_new = []
for cid in sorted(set(h) & set(c)):
    a = h[cid][1]
    b = c[cid][1]
    if a != b:
        lines.append(f"--- changed {cid} {a.get('name')}")
        for k in sorted(set(a) | set(b)):
            if a.get(k) != b.get(k):
                lines.append(f"  {k}:")
                lines.append(f"   HEAD: {json.dumps(a.get(k), ensure_ascii=False)[:500]}")
                lines.append(f"   CUR : {json.dumps(b.get(k), ensure_ascii=False)[:500]}")
    if (not a.get("url") and b.get("url")) or (
        a.get("url_verified") is False and b.get("url_verified") is True
    ):
        url_verified_new.append(
            (cid, b.get("name"), b.get("url"), b.get("url_verified"))
        )

for cid in sorted(set(c) - set(h)):
    _d, b = c[cid]
    lines.append(f"--- added {cid} {b.get('name')}")
    lines.append(f"  url={b.get('url')} url_verified={b.get('url_verified')}")
    lines.append(f"  skills={b.get('skills')}")

lines.append("=== url filled / url_verified true ===")
for item in url_verified_new:
    lines.append(str(item))
for cid in sorted(set(c) - set(h)):
    b = c[cid][1]
    if b.get("url_verified"):
        lines.append(f"NEW {cid} {b.get('name')} {b.get('url')}")

# skills that mention 课件制作
lines.append("=== 课件制作 coverage ===")
for d in cur["directions"]:
    for course in d["courses"]:
        if "课件制作" in (course.get("skills") or []):
            lines.append(
                f"  course {course['course_id']} {course['name']} skills={course['skills']}"
            )
    if "课件制作" in (d.get("skills") or []):
        lines.append(f"  direction {d['id']} has skill 课件制作")

# jobs check
jobs_path = Path("data/jobs.json")
if jobs_path.exists():
    jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
    # find 课件制作 references
    text = json.dumps(jobs, ensure_ascii=False)
    lines.append(f"jobs.json contains 课件制作: {'课件制作' in text}")

Path("_courses_semdiff.txt").write_text("\n".join(lines), encoding="utf-8")
print("wrote _courses_semdiff.txt")
