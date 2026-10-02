#!/usr/bin/env python
"""单帧快速确认：脸部红晕是否还绿、头发外沿红边是否已消。用主脚本的 background_mask。"""
from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "media-src" / "mainframe-bg-red.mp4"
OUT = ROOT / "scripts" / "assets" / "quick-check.jpg"

_spec = importlib.util.spec_from_file_location("rvb", ROOT / "scripts" / "recolor-video-background.py")
rvb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rvb)


def grab(ff, at):
    p = subprocess.run([ff, "-v", "error", "-ss", str(at), "-i", str(SRC),
                        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                       capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.uint8)[: 1080 * 1920 * 3].reshape(1080, 1920, 3)


def main():
    ff = rvb.find_ffmpeg()
    regions = [
        ("脸（红晕/鼻头）", (380, 700, 1180, 1620)),
        ("头顶外沿（泛光）", (40, 330, 1150, 1560)),
        ("左肩外沿", (700, 1000, 1060, 1400)),
    ]
    tiles = []
    for at in (2.0, 4.0):
        fr = grab(ff, at)
        rgb = fr.astype(np.float32)
        w = rvb.background_mask(rgb)[..., None]
        h, s, v = rvb.rgb_to_hsv_deg(rgb)
        shifted = rvb.hsv_to_rgb((h + rvb.HUE_SHIFT) % 360.0, s, v)
        out = np.clip(rgb * (1 - w) + shifted * w, 0, 255).astype(np.uint8)
        for name, (y0, y1, x0, x1) in regions:
            tiles.append((f"{name} t={at}s  原始", fr[y0:y1, x0:x1]))
            tiles.append((f"{name} t={at}s  换色", out[y0:y1, x0:x1]))
        # 顺带统计脸部「变绿」的像素
        face = (slice(420, 680), slice(1250, 1550))
        turned = (out[:, :, 1].astype(int) - out[:, :, 0] > 30) & (out[:, :, 1].astype(int) - out[:, :, 2] > 30)
        print(f"t={at}s  脸部框内被染绿：{turned[face].sum()} px / {turned[face].size} "
              f"({turned[face].mean()*100:.3f}%)")

    W = 620
    ims = []
    for title, t in tiles:
        h = int(t.shape[0] * W / t.shape[1])
        ims.append((title, np.asarray(Image.fromarray(t).resize((W, h), Image.LANCZOS))))
    Ht = ims[0][1].shape[0]
    cols = 2
    rows = (len(ims) + cols - 1) // cols
    canvas = Image.new("RGB", (W * cols + 12 * (cols + 1), (Ht + 34) * rows + 8), (26, 26, 26))
    dr = ImageDraw.Draw(canvas)
    for i, (title, im) in enumerate(ims):
        r, c = divmod(i, cols)
        x = 12 + c * (W + 12); y = 8 + r * (Ht + 34)
        canvas.paste(Image.fromarray(im), (x, y + 26))
        dr.text((x + 6, y + 6), title, fill=(255, 220, 120))
    canvas.save(OUT, quality=94)
    print(f"→ {OUT} ({canvas.width}x{canvas.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
