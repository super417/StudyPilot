#!/usr/bin/env python
"""
量测 Mainframe 背景视频里人物的脸朝向、以及它随时间往哪边转。

为什么需要它
------------
3/4 侧脸用肉眼极容易读反 —— 本项目就因此把鼠标跟随方向做反过一次（主人发现后才纠正）。
这里改用两个可量化的特征，都不依赖主观判断：

1. **鼻尖在头部包围盒内的相对横坐标**：越接近 1 说明脸越朝右，越接近 0 越朝左。
2. **肤色（脸）质心相对头部质心的偏移**：偏右 = 后脑勺在左 = 脸朝右；偏左则相反。

用法
----
    python scripts/measure-mainframe-look-direction.py [视频路径]

默认读 `frontend/public/mainframe-bg.mp4`。
需要 `numpy`；ffmpeg 直接取 `imageio-ffmpeg` 自带的那份（`pip install imageio-ffmpeg`），
不必在系统里另装 ffmpeg。
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np

W, H = 960, 540
DEFAULT_VIDEO = Path(__file__).resolve().parent.parent / "frontend" / "public" / "mainframe-bg.mp4"


def find_ffmpeg() -> str:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # pragma: no cover - 取决于本机环境
        return "ffmpeg"


def grab(ffmpeg: str, video: Path, t: float) -> np.ndarray:
    proc = subprocess.run(
        [
            ffmpeg, "-v", "error", "-ss", str(t), "-i", str(video),
            "-frames:v", "1", "-vf", f"scale={W}:{H}",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ],
        capture_output=True,
        check=True,
    )
    return np.frombuffer(proc.stdout, dtype=np.uint8)[: W * H * 3].reshape(H, W, 3).astype(np.float32)


def measure(frame: np.ndarray) -> tuple[float, float, float, float] | None:
    """返回 (鼻尖相对位, 脸质心相对位, 头左, 头右)，全部相对画面宽度归一化。"""
    r, g, b = frame[:, :, 0], frame[:, :, 1], frame[:, :, 2]
    # 背景是纯红渐变（G 很低），人物 = 肤色 ∪ 棕色头发
    skin = (r > 190) & (g > 115) & (b > 95) & (r - b > 25)
    hair = (r > 60) & (r < 180) & (g > 35) & (g < 135) & (b < 115) & (r > g) & (g >= b)
    head = skin | hair
    body_cut = int(H * 0.72)          # 切掉身体和绿衣服，只看头
    head[body_cut:, :] = False
    skin[body_cut:, :] = False

    ys, xs = np.where(head)
    if len(xs) < 500:
        return None
    hx0, hx1 = xs.min(), xs.max()
    span = max(hx1 - hx0, 1)

    sy, sx = np.where(skin)
    if len(sx) < 200:
        return None
    # 鼻尖 = 肤色里最红的点（红鼻子比脸颊更饱和），取最红的前 0.3%
    redness = (r - g)[sy, sx]
    sel = redness >= np.percentile(redness, 99.7)
    nose_x = sx[sel].mean()

    return (
        (nose_x - hx0) / span,
        (sx.mean() - hx0) / span,
        hx0 / W,
        hx1 / W,
    )


def main() -> int:
    video = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_VIDEO
    if not video.exists():
        print(f"找不到视频：{video}")
        return 1
    ffmpeg = find_ffmpeg()

    print(f"视频：{video}\n")
    print(f"{'t(s)':>6} {'鼻尖相对位':>11} {'脸质心相对位':>13} {'头左':>7} {'头右':>7}")

    samples: list[tuple[float, float]] = []
    for t in (0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 3.95):
        m = measure(grab(ffmpeg, video, t))
        if m is None:
            print(f"{t:6.2f}   (识别不到人物)")
            continue
        nose_rel, face_rel, hx0, hx1 = m
        samples.append((nose_rel, face_rel))
        print(f"{t:6.2f} {nose_rel:11.3f} {face_rel:13.3f} {hx0:7.3f} {hx1:7.3f}")

    if len(samples) < 2:
        print("\n样本不足，无法给出结论。")
        return 1

    first_nose, first_face = samples[0]
    last_nose, last_face = samples[-1]
    turning_right = last_nose > first_nose
    first_dir = "左" if turning_right else "右"
    last_dir = "右" if turning_right else "左"
    print()
    print(f"鼻尖相对位 {first_nose:.3f} → {last_nose:.3f}；脸质心相对位 {first_face:.3f} → {last_face:.3f}")
    print(f"→ 首帧脸朝{first_dir}，末帧脸朝{last_dir}（人物随时间向{'右' if turning_right else '左'}转）")
    print()
    print("据此在 MainframePage 里设 `target = clientX / innerWidth`（鼠标越靠右 → 进度越靠后）"
          if turning_right
          else "据此在 MainframePage 里设 `target = 1 - clientX / innerWidth`（鼠标越靠左 → 进度越靠后）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
