#!/usr/bin/env python
"""
「把人物衣服改成原来背景的红色」会和谐吗 —— 做出来看，别猜。

做法：按色相把人物下身的衣服（橄榄/卡其，H≈45°）分割出来，只改它的色相，
饱和度和明度原样保留（和换背景用的是同一套保色方法），渲染几个方案对比。
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
GREEN = ROOT / "frontend" / "public" / "mainframe-bg.mp4"
OUT = ROOT / "scripts" / "assets" / "coat-color-options.jpg"

# 衣服实测：H≈45° S≈0.70 V≈0.51（下部区域色相直方图 40~50° 占 44503px）
COAT_H_LO, COAT_H_HI = 18.0, 95.0
COAT_Y_FROM = 690          # 衣服大约从这一行往下
COAT_S_MIN = 0.28
FEATHER = 2.0


def find_ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def rgb_to_hsv_deg(rgb):
    f = rgb / 255.0
    mx = f.max(axis=2); mn = f.min(axis=2); d = mx - mn
    r, g, b = f[:, :, 0], f[:, :, 1], f[:, :, 2]
    hue = np.zeros_like(mx); nz = d > 1e-9
    safe = np.where(nz, d, 1.0)
    m1 = nz & (mx == r); m2 = nz & (mx == g) & ~m1; m3 = nz & (mx == b) & ~m1 & ~m2
    hue[m1] = ((g - b) / safe)[m1] % 6.0
    hue[m2] = ((b - r) / safe)[m2] + 2.0
    hue[m3] = ((r - g) / safe)[m3] + 4.0
    hue *= 60.0
    sat = np.where(mx > 1e-9, d / np.maximum(mx, 1e-9), 0.0)
    return hue, sat, mx


def hsv_to_rgb(hue, sat, val):
    c = val * sat
    hp = (hue / 60.0) % 6.0
    x = c * (1.0 - np.abs(hp % 2.0 - 1.0))
    m = val - c
    z = np.zeros_like(c)
    cond = [hp < 1, hp < 2, hp < 3, hp < 4, hp < 5]
    r = np.select(cond, [c, x, z, z, x], default=c)
    g = np.select(cond, [x, c, c, x, z], default=z)
    b = np.select(cond, [z, z, x, c, c], default=x)
    return np.stack([(r + m) * 255.0, (g + m) * 255.0, (b + m) * 255.0], axis=-1)


def coat_mask(rgb):
    hue, sat, val = rgb_to_hsv_deg(rgb)
    m = (hue > COAT_H_LO) & (hue < COAT_H_HI) & (sat > COAT_S_MIN)
    m[:COAT_Y_FROM, :] = False
    # 只保留最大的一块（衣服），去掉零散误判
    lab, n = ndimage.label(m)
    if n > 1:
        sizes = ndimage.sum(m, lab, range(1, n + 1))
        m = lab == (int(np.argmax(sizes)) + 1)
    return ndimage.gaussian_filter(m.astype(np.float32), FEATHER, mode="nearest")


def recolor_coat(rgb, hue_to, sat_mul=1.0, val_mul=1.0):
    """把衣服的色相搬到 hue_to，S/V 可选缩放；其余像素不动。"""
    hue, sat, val = rgb_to_hsv_deg(rgb)
    w = coat_mask(rgb)[..., None]
    new = hsv_to_rgb(hue_to, np.clip(sat * sat_mul, 0, 1), np.clip(val * val_mul, 0, 1))
    return rgb * (1 - w) + new * w


def srgb_to_lab(rgb):
    """sRGB(0-255) → CIE Lab（D65）。用于算 ΔE76。"""
    c = rgb / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805],
                  [0.2126, 0.7152, 0.0722],
                  [0.0193, 0.1192, 0.9505]])
    xyz = lin @ m.T / np.array([0.95047, 1.0, 1.08883])
    e, k = 216 / 24389, 24389 / 27
    f = np.where(xyz > e, np.cbrt(xyz), (k * xyz + 16) / 116)
    fx, fy, fz = f[..., 0], f[..., 1], f[..., 2]
    return np.stack([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)], axis=-1)


def mean_rgb(rgb, rule):
    hue, sat, val = rgb_to_hsv_deg(rgb)
    m = rule(hue, sat, val)
    n = int(m.sum())
    if n == 0:
        return None, 0
    return rgb[m].mean(axis=0), n


def contrast_report(rgb, options):
    """把衣服和「头发 / 皮肤 / 背景暗侧 / 背景亮侧」的分离度量化出来。"""
    refs = {
        "头发": lambda h, s, v: (h < 35) & (s > 0.45) & (v < 0.75),
        "皮肤": lambda h, s, v: (h > 5) & (h < 30) & (s > 0.25) & (s < 0.65) & (v > 0.85),
        "背景(暗)": lambda h, s, v: (h > 95) & (h < 135) & (s > 0.85) & (v < 0.70),
        "背景(亮)": lambda h, s, v: (h > 95) & (h < 135) & (s > 0.60) & (v > 0.90),
    }
    print("\n参考色（sRGB / HSV）：")
    ref_lab = {}
    for name, rule in refs.items():
        c, n = mean_rgb(rgb, rule)
        if c is None:
            print(f"  {name}: 未采到样本")
            continue
        hh, ss, vv = rgb_to_hsv_deg(c.reshape(1, 1, 3))
        ref_lab[name] = srgb_to_lab(c)
        print(f"  {name:<8} RGB({c[0]:6.1f},{c[1]:6.1f},{c[2]:6.1f})  "
              f"H{hh[0, 0]:6.1f}° S{ss[0, 0]:.3f} V{vv[0, 0]:.3f}  n={n}")

    print("\n衣服 → 各参考色的 ΔE76（<10 基本糊在一起，10~25 可辨，>25 强分离）：")
    print(f"  {'方案':<26}{'头发':>10}{'皮肤':>10}{'背景(暗)':>12}{'背景(亮)':>12}")
    for title, kw in options:
        if kw is None:
            coat = rgb[coat_mask(rgb) > 0.5].mean(axis=0)
        else:
            img = recolor_coat(rgb, **kw)
            coat = img[coat_mask(rgb) > 0.5].mean(axis=0)
        cl = srgb_to_lab(coat)
        row = "".join(
            f"{np.linalg.norm(cl - ref_lab[k]):>12.1f}" if k in ref_lab else f"{'—':>12}"
            for k in ("头发", "皮肤", "背景(暗)", "背景(亮)")
        )
        print(f"  {title:<26}{row}")


def main():
    ff = find_ffmpeg()
    p = subprocess.run([ff, "-v", "error", "-ss", "2.0", "-i", str(GREEN),
                        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                       capture_output=True, check=True)
    fr = np.frombuffer(p.stdout, dtype=np.uint8)[: 1080 * 1920 * 3].reshape(1080, 1920, 3)
    rgb = fr.astype(np.float32)

    m = coat_mask(rgb)
    print(f"衣服 mask 覆盖 {m.sum():.0f} px（等效全权重），"
          f"y>{COAT_Y_FROM} 区域内占比 {(m[COAT_Y_FROM:] > 0.5).mean()*100:.1f}%")

    options = [
        ("A 现状（橄榄）", None),
        ("B 改成原背景红 353°", dict(hue_to=353.0)),
        ("C 深酒红（红 353° 压暗）", dict(hue_to=353.0, sat_mul=0.85, val_mul=0.62)),
        ("D 深藏青 225°（分离色相）", dict(hue_to=225.0, sat_mul=0.55, val_mul=0.45)),
        ("E 深墨绿 150°（同色系压暗）", dict(hue_to=150.0, sat_mul=0.55, val_mul=0.42)),
        ("F 暖棕 25°（贴头发色系）", dict(hue_to=25.0, sat_mul=0.75, val_mul=0.55)),
        ("G 洋红深红 335°（红里最分离）", dict(hue_to=335.0, sat_mul=0.85, val_mul=0.62)),
    ]

    outs = []
    for title, kw in options:
        img = fr if kw is None else np.clip(recolor_coat(rgb, **kw), 0, 255).astype(np.uint8)
        outs.append((title, img))

    contrast_report(rgb, options)

    # 第一行：整帧；第二行：衣服特写
    W = 620
    h_full = int(1080 * W / 1920)
    y0, y1, x0, x1 = 700, 1080, 1020, 1560
    Z = 1.06
    wz, hz = int((x1 - x0) * Z), int((y1 - y0) * Z)

    cols = 3
    rows = (len(outs) + cols - 1) // cols
    pad, gap = 14, 12
    tile_h = h_full + 30 + gap + hz + 30
    canvas = Image.new("RGB", (pad * 2 + (W + gap) * cols - gap, pad * 2 + tile_h * rows), (22, 22, 22))
    d = ImageDraw.Draw(canvas)
    for i, (title, img) in enumerate(outs):
        r, c = divmod(i, cols)
        x = pad + c * (W + gap)
        y = pad + r * tile_h
        d.text((x + 4, y), title, fill=(255, 220, 120))
        canvas.paste(Image.fromarray(img).resize((W, h_full), Image.LANCZOS), (x, y + 22))
        d.text((x + 4, y + h_full + 26), "衣服特写", fill=(150, 200, 255))
        canvas.paste(Image.fromarray(img[y0:y1, x0:x1]).resize((wz, hz), Image.LANCZOS),
                     (x, y + h_full + 46))
    canvas.save(OUT, quality=93)
    print(f"→ {OUT} ({canvas.width}x{canvas.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
