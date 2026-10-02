#!/usr/bin/env python
"""
诊断：换色后头发外沿的过渡为什么不如原片自然。

原片（红幕）里，发丝外沿被红幕打光，颜色本来就贴着幕布 → 看着是"自然过渡"。
换成绿幕后，如果这些发丝像素的权重 w 接近 0，它们就保持红棕色 → 在绿底上
读成一圈硬红边/发光轮廓。

这个脚本把「红族像素里 w 低的那一批」单独标出来，并打印它们卡在哪一道门上：
色相窗 hue_w / 到种子距离 dist_term / 泛光 glow。
"""

from __future__ import annotations

import argparse
import importlib.util
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
RED = ROOT / "media-src" / "mainframe-bg-red.mp4"
GREEN = ROOT / "frontend" / "public" / "mainframe-bg.mp4"
OUT = ROOT / "scripts" / "assets" / "hair-edge-diag.jpg"

_spec = importlib.util.spec_from_file_location(
    "rbg", ROOT / "scripts" / "recolor-video-background.py")
rbg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rbg)


def frame(ff: str, src: Path, at: float) -> np.ndarray:
    p = subprocess.run([ff, "-v", "error", "-ss", str(at), "-i", str(src),
                        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                       capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.uint8)[:1080 * 1920 * 3].reshape(1080, 1920, 3).astype(np.float32)


def terms(rgb):
    """复刻 background_mask 的每一道门，方便看是哪一道把权重压下去的。"""
    hue, sat, val = rbg.rgb_to_hsv_deg(rgb)
    dist = np.abs(hue - rbg.BG_HUE)
    dist = np.minimum(dist, 360.0 - dist)
    hue_w = 1.0 - rbg.soft_ramp(dist, rbg.HUE_FULL, rbg.HUE_ZERO)

    tex = rbg.highpass_energy(rgb.mean(axis=2))
    flat = (tex < rbg.TEX_FLAT) & (dist < rbg.SEED_HUE)
    labels, _ = ndimage.label(flat)
    edge = np.unique(np.concatenate([labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]]))
    edge = edge[edge != 0]
    seed = np.isin(labels, edge) if edge.size else flat
    d = ndimage.distance_transform_edt(~seed)
    dist_term = 1.0 - rbg.soft_ramp(d, rbg.DIST_LO, rbg.DIST_HI)

    glow = rbg.soft_ramp(val, rbg.GLOW_VAL_LO, rbg.GLOW_VAL_HI) * \
        rbg.soft_ramp(sat, rbg.GLOW_SAT_LO, rbg.GLOW_SAT_HI)
    glow *= 1.0 - rbg.soft_ramp(d, rbg.GLOW_DIST_LO, rbg.GLOW_DIST_HI)

    return dict(hue=hue, sat=sat, val=val, dist=dist, hue_w=hue_w,
                seed=seed, d=d, dist_term=dist_term, glow=glow)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--at", type=float, default=2.0)
    ap.add_argument("--crop", type=str, default="1180,0,1540,240")
    ap.add_argument("--zoom", type=float, default=3.2)
    ap.add_argument("--src", type=Path, default=RED)
    args = ap.parse_args()
    x0, y0, x1, y1 = (int(v) for v in args.crop.split(","))

    ff = rbg.find_ffmpeg()
    src = frame(ff, args.src, args.at)
    out = np.clip(rbg.recolor(src, rbg.HUE_SHIFT), 0, 255)
    t = terms(src)
    w = rbg.background_mask(src)

    # 「红族」= 色相上本来贴着红幕（角距离 < 25°）的像素
    reddish = t["dist"] < 25.0

    print(f"@{args.at}s  crop={args.crop}")
    print(f"  全帧背景权重均值 {w.mean():.4f}；红族像素 {(reddish).sum()} px")
    print(f"  红族像素 w 分布：p10={np.percentile(w[reddish],10):.3f} "
          f"p50={np.percentile(w[reddish],50):.3f} p90={np.percentile(w[reddish],90):.3f}")

    # 只看红族里 w 低的那批，看它们卡在哪
    bad = reddish & (w < 0.5)
    n = int(bad.sum())
    print(f"  红族 & w<0.5 的像素：{n} px（这些在绿底上会留红）")
    if n:
        for k in ("dist", "val", "sat", "d", "hue_w", "dist_term", "glow"):
            v = t[k][bad]
            print(f"    {k:<10} p10={np.percentile(v,10):8.3f} "
                  f"p50={np.percentile(v,50):8.3f} p90={np.percentile(v,90):8.3f}")
        # 哪一道门先归零
        blocks = {
            "色相窗外(dist>15)": int((t["dist"][bad] > rbg.HUE_ZERO).sum()),
            "距离太远(dist_term=0)": int((t["dist_term"][bad] < 1e-6).sum()),
            "泛光未触发(glow=0)": int((t["glow"][bad] < 1e-6).sum()),
            "泛光被距离门掐死": int(((t["glow"][bad] > 1e-6) &
                                 (1.0 - rbg.soft_ramp(t["d"][bad], rbg.GLOW_DIST_LO, rbg.GLOW_DIST_HI) < 0.5)).sum()),
        }
        for k, v in blocks.items():
            print(f"    {k:<22} {v:7d} px  ({v/n*100:5.1f}%)")
        # 距离门到底卡在哪
        dd = t["d"][bad]
        print(f"    到种子距离分位：p50={np.percentile(dd,50):.1f} "
              f"p90={np.percentile(dd,90):.1f} p99={np.percentile(dd,99):.1f} "
              f"max={dd.max():.1f}  (DIST_HI={rbg.DIST_HI}, GLOW_DIST_HI={rbg.GLOW_DIST_HI})")

    # 出图：源 | 成品 | w | 问题像素标红
    mark = src.copy()
    mark[bad] = np.array([0, 255, 255], dtype=np.float32)
    tiles = [src, out, np.repeat((w * 255)[..., None], 3, axis=2), mark]
    names = ["原始（红幕）", "换色后（绿幕）", "w 权重", "红族 & w<0.5（青）"]
    crops = [Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).crop((x0, y0, x1, y1)) for a in tiles]
    zw, zh = int((x1 - x0) * args.zoom), int((y1 - y0) * args.zoom)
    tiles_img = [im.resize((zw, zh), Image.NEAREST) for im in crops]

    pad, gap, head = 14, 12, 26
    canvas = Image.new("RGB", (pad * 2 + (zw + gap) * 2 - gap, head * 2 + (zh + gap) * 2 + pad * 2), (24, 24, 24))
    d = ImageDraw.Draw(canvas)
    for i, (nm, im) in enumerate(zip(names, tiles_img)):
        r, c = divmod(i, 2)
        x = pad + c * (zw + gap)
        y = pad + r * (zh + head + gap)
        d.text((x + 4, y + 6), nm, fill=(255, 220, 120))
        canvas.paste(im, (x, y + head))
    canvas.save(OUT, quality=93)
    print(f"→ {OUT} ({canvas.width}x{canvas.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
