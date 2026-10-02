#!/usr/bin/env python
"""全片验证：对 97 帧逐帧跑 background_mask，检查
  1) 真幕布是否每帧都是满权重（不能出现「换色不彻底」的灰区）
  2) 权重是否逐帧稳定（不能闪烁）
  3) 人物身上是否还有高权重（窜色）
  4) 被困在人物里的幕布口袋是否被换干净（头转动时幕布被运动模糊拖花，
     平坦判据失效，靠「幕布色匹配」兜底；这一项专门盯它有没有兜住）
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
SRC = ROOT / "media-src" / "mainframe-bg-red.mp4"
W, H = 960, 540

import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "rvb", ROOT / "scripts" / "recolor-video-background.py")
rvb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rvb)


def find_ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def main():
    ff = find_ffmpeg()
    p = subprocess.run([ff, "-v", "error", "-i", str(SRC), "-vf", f"scale={W}:{H}",
                        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                       capture_output=True, check=True)
    buf = np.frombuffer(p.stdout, dtype=np.uint8)
    n = buf.size // (W * H * 3)
    frames = buf[: n * W * H * 3].reshape(n, H, W, 3).astype(np.float32)
    print(f"{n} 帧 {W}x{H}")

    # 静态区域：左上角一大块确定是幕布；头/身用「全片最小权重」定位
    bg_box = (slice(10, 150), slice(10, 200))

    weights = np.empty((n, H, W), dtype=np.float32)
    for i in range(n):
        weights[i] = rvb.background_mask(frames[i])
        if (i + 1) % 20 == 0:
            print(f"  {i+1}/{n}", flush=True)

    means = weights.mean(axis=(1, 2))
    bg_w = weights[:, bg_box[0], bg_box[1]]
    print("\n=== 1) 真幕布是否每帧满权重 ===")
    print(f"  幕布区权重：全局最小={bg_w.min():.4f}  每帧最小值的范围="
          f"{bg_w.reshape(n, -1).min(axis=1).min():.4f} ~ {bg_w.reshape(n, -1).min(axis=1).max():.4f}")
    print(f"  幕布区每帧低于 0.95 的像素占比：最大={np.mean(bg_w < 0.95, axis=(1, 2)).max()*100:.4f}%")

    print("\n=== 2) 逐帧稳定性 ===")
    print(f"  全帧平均权重：min={means.min():.4f} max={means.max():.4f} "
          f"std={means.std():.5f}  （std 小 = 不闪烁）")
    # 逐像素时间标准差：真幕布处应接近 0
    tstd = weights.std(axis=0)
    print(f"  幕布区时间标准差：max={tstd[bg_box].max():.5f}  "
          f"p99={np.percentile(tstd[bg_box], 99):.5f}")
    print(f"  全图时间标准差：p50={np.median(tstd):.4f} p90={np.percentile(tstd,90):.4f} "
          f"p99={np.percentile(tstd,99):.4f}")

    print("\n=== 3) 人物身上是否还有高权重 ===")
    # 用全片最小权重图定位「人物」：任何一帧里都是低权重的地方
    always_low = weights.max(axis=0) < 0.5
    print(f"  全片始终 <0.5 的像素：{always_low.sum()}（人物核心）")
    never_green = weights.max(axis=0)
    print(f"  这些像素上、全片最大权重：max={never_green[always_low].max():.4f}")
    # 反例：某帧权重高、另一帧低 —— 说明这一块有时被当背景
    unstable = (weights.max(axis=0) > 0.8) & (weights.min(axis=0) < 0.2)
    print(f"  权重在 >0.8 与 <0.2 之间跳变的像素：{unstable.sum()} "
          f"（应集中在轮廓过渡带，成片出现说明判据不稳）")

    print("\n=== 4) 被困在人物里的幕布口袋是否换干净 ===")
    # 亮幕布红里「不与画面边缘连通」的连通块 = 被人物围住的幕布口袋。
    # 这是「幕布色匹配」那一项存在的唯一理由，所以单独盯住。
    # 960x540 下用 >=8px（对应全分辨率约 32px）。
    from scipy import ndimage
    worst = []
    for i in range(n):
        r, g, b = frames[i][:, :, 0], frames[i][:, :, 1], frames[i][:, :, 2]
        hue, sat, val = rvb.rgb_to_hsv_deg(frames[i])
        dd = np.abs(hue - rvb.BG_HUE)
        dd = np.minimum(dd, 360.0 - dd)
        leak = (dd < 12) & (sat > 0.80) & (val > 0.45) & (r > g + 80)
        lab, k = ndimage.label(leak)
        if k == 0:
            continue
        border = set(np.unique(np.concatenate(
            [lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]])).tolist())
        sizes = ndimage.sum(leak, lab, range(1, k + 1))
        for j in range(k):
            if (j + 1) in border or sizes[j] < 8:
                continue
            m = lab == j + 1
            worst.append((i, int(sizes[j]), float(weights[i][m].min()),
                          float(np.mean(weights[i][m] < 0.6))))
    if not worst:
        print("  全片没有 >=8px 的封闭幕布口袋")
    else:
        worst.sort(key=lambda t: t[3], reverse=True)
        print(f"  有封闭幕布口袋的帧：{len({w[0] for w in worst})} / {n}")
        print(f"  口袋里 w<0.6 的像素占比：最大={worst[0][3]*100:.1f}% "
              f"（帧{worst[0][0]}，{worst[0][1]}px，最小权重 {worst[0][2]:.3f}）")
        bad = [w for w in worst if w[3] > 0.05]
        print(f"  占比 >5% 的口袋：{len(bad)} 个" + (
            f"，最差 {bad[0][1]}px 帧{bad[0][0]} 占比{bad[0][3]*100:.1f}%" if bad else "（全部合格）"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
