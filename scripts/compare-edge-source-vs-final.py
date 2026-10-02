#!/usr/bin/env python
"""对比「原始红幕帧」与「最终绿幕帧」，高倍放大看人物轮廓 —— 判断红边是源素材自带还是换色引入的。"""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RED = ROOT / "media-src" / "mainframe-bg-red.mp4"
GREEN = ROOT / "frontend" / "public" / "mainframe-bg.mp4"
OUT = ROOT / "scripts" / "assets" / "edge-compare.jpg"


def find_ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def grab(ff, src, at):
    p = subprocess.run([ff, "-v", "error", "-ss", str(at), "-i", str(src),
                        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                       capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.uint8)[: 1080 * 1920 * 3].reshape(1080, 1920, 3)


def main():
    ff = find_ffmpeg()
    a = grab(ff, RED, 2.0)
    b = grab(ff, GREEN, 2.0)

    # 沿着一条水平扫描线打印 RGB，看轮廓过渡到底多宽
    for y in (300, 620):
        print(f"\n=== 扫描线 y={y}（人物左轮廓附近 x=980..1060）===")
        for x in range(980, 1061, 4):
            print(f"  x={x:4d}  红幕源 RGB={tuple(int(v) for v in a[y, x])}   "
                  f"绿幕输出 RGB={tuple(int(v) for v in b[y, x])}")

    crops = [
        ("头顶轮廓 x1240-1420 y60-220", (60, 220, 1240, 1420)),
        ("左侧脸轮廓 x980-1140 y560-700", (560, 700, 980, 1140)),
        ("画面左边缘 x0-60 y180-420", (180, 420, 0, 60)),
    ]
    Z = 4
    rows = []
    for title, (y0, y1, x0, x1) in crops:
        rows.append((title, a[y0:y1, x0:x1], b[y0:y1, x0:x1]))

    W = 640
    tiles = []
    for title, ra, rb in rows:
        h = int(ra.shape[0] * W / ra.shape[1])
        tiles.append((title + "  原始红幕", np.asarray(Image.fromarray(ra).resize((W, h), Image.NEAREST))))
        tiles.append((title + "  最终绿幕", np.asarray(Image.fromarray(rb).resize((W, h), Image.NEAREST))))

    Ht = tiles[0][1].shape[0]
    canvas = Image.new("RGB", (W * 2 + 36, (Ht + 34) * len(rows) + 8), (26, 26, 26))
    dr = ImageDraw.Draw(canvas)
    for i, (title, t) in enumerate(tiles):
        r, c = divmod(i, 2)
        x = 12 + c * (W + 12); y = 8 + r * (Ht + 34)
        canvas.paste(Image.fromarray(t), (x, y + 26))
        dr.text((x + 6, y + 6), title, fill=(255, 220, 120))
    canvas.save(OUT, quality=94)
    print(f"\n→ {OUT} ({canvas.width}x{canvas.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
