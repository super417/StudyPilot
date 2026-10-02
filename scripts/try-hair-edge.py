#!/usr/bin/env python
"""
对比台：头发外沿的软过渡到底要开多宽。

诊断结论（见 diag-hair-edge.py）：现状权重从 1 掉到 0 只用了 6px，而红幕版
「幕布→头发」的视觉过渡实际横跨 ~24px。红幕上色相不断，只有明度斜坡，所以看着自然；
换成绿幕之后同样的 6px 里色相要跨 120°，就成了硬边。

这个脚本把几组参数并排渲染出来，直接看。
"""

from __future__ import annotations

import argparse
import importlib.util
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RED = ROOT / "media-src" / "mainframe-bg-red.mp4"
OUT = ROOT / "scripts" / "assets" / "hair-edge-variants.jpg"

_spec = importlib.util.spec_from_file_location(
    "rbg", ROOT / "scripts" / "recolor-video-background.py")
rbg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rbg)

# (标题, 覆盖的模块级常量)
VARIANTS = [
    ("旧：dist 2→10（8px 硬过渡）", {"DIST_LO": 2.0, "DIST_HI": 10.0}),
    ("新：dist 0→24（24px 软过渡）", {}),
]


def frame(ff: str, src: Path, at: float) -> np.ndarray:
    p = subprocess.run([ff, "-v", "error", "-ss", str(at), "-i", str(src),
                        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                       capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.uint8)[:1080 * 1920 * 3].reshape(1080, 1920, 3).astype(np.float32)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--at", type=float, default=2.0)
    ap.add_argument("--crop", type=str, default="1140,40,1460,320")
    ap.add_argument("--zoom", type=float, default=3.0)
    args = ap.parse_args()
    x0, y0, x1, y1 = (int(v) for v in args.crop.split(","))

    ff = rbg.find_ffmpeg()
    src = frame(ff, RED, args.at)

    keep = {k: getattr(rbg, k) for k in
            ("DIST_LO", "DIST_HI", "HUE_FULL", "HUE_ZERO")}
    tiles, names = [src], ["原始（红幕）"]
    for title, ov in VARIANTS:
        for k, v in keep.items():
            setattr(rbg, k, ov.get(k, v))
        tiles.append(np.clip(rbg.recolor(src, rbg.HUE_SHIFT), 0, 255))
        names.append(title)
    for k, v in keep.items():
        setattr(rbg, k, v)

    zw, zh = int((x1 - x0) * args.zoom), int((y1 - y0) * args.zoom)
    imgs = [Image.fromarray(a.astype(np.uint8)).crop((x0, y0, x1, y1)).resize((zw, zh), Image.LANCZOS)
            for a in tiles]

    cols = 3
    rows = (len(imgs) + cols - 1) // cols
    pad, gap, head = 14, 12, 24
    canvas = Image.new("RGB", (pad * 2 + (zw + gap) * cols - gap,
                               pad * 2 + (zh + head + gap) * rows - gap), (24, 24, 24))
    d = ImageDraw.Draw(canvas)
    for i, (nm, im) in enumerate(zip(names, imgs)):
        r, c = divmod(i, cols)
        x = pad + c * (zw + gap)
        y = pad + r * (zh + head + gap)
        d.text((x + 4, y + 5), nm, fill=(255, 220, 120))
        canvas.paste(im, (x, y + head))
    canvas.save(OUT, quality=93)
    print(f"→ {OUT} ({canvas.width}x{canvas.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
