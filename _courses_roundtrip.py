import difflib
import json
import subprocess
from pathlib import Path

from _courses_reformat import dumps

head_text = subprocess.check_output(
    ["git", "show", "HEAD:data/courses.json"], text=True, encoding="utf-8"
)
head = json.loads(head_text)
rt = dumps(head) + "\n"
rt = rt.replace('  },\n  "directions":', '  },\n\n  "directions":', 1)
Path("_head_roundtrip.json").write_text(rt, encoding="utf-8")
print("head lines", head_text.count("\n") + 1, "rt lines", rt.count("\n") + 1)
diff = list(
    difflib.unified_diff(head_text.splitlines(), rt.splitlines(), lineterm="")
)
print("diff lines", len(diff))
Path("_head_roundtrip.diff").write_text("\n".join(diff[:200]), encoding="utf-8")
print("wrote first 200 diff lines")
