#!/usr/bin/env python
"""
把视频里「单一色相的背景幕布」换成另一个色相，人物/主体保持不变。

用在 Mainframe 背景上：原始素材是红幕（色相约 353°），换成绿幕（+120° → 113°），
同时把编码改成**全 I 帧**，让前端鼠标 scrub 时 seek 不必回溯解码，消除卡顿。

为什么不能只看颜色
------------------
头发是红棕色，被红幕**打光**之后（发丝反光、轮廓受光），一大片头发的色相直接落在
幕布的色相窗口里，而且和幕布**连通**。实测（第 4.0s 帧，1920x1080）：

    区域            到 353° 角距离      饱和度            明度
    真幕布(左)      p50=2.9  p99=5.0   p50=0.993        p50=0.514
    真幕布(右)      p50=4.5  p99=7.7   p50=0.780        p50=0.961
    受光头发        p50=3.3  p90=8.4   p50=0.791        p50=0.761

角距离、饱和度、明度**三项全部重叠** —— 幕布本身有一条从「暗红(0.48) + 满饱和」
到「亮红(0.96) + 低饱和(0.78)」的光照渐变，受光头发正好落在渐变中间。
颜色这条路是死的。

能分开的只有**平坦度**：
    真幕布 tex9（高通能量）p99 = 0.47(左) / 0.56(右)；人物身上最低 0.65。
所以取 `tex9 < 0.6` 当「确定是幕布」的种子 —— 它天然就是完整的一大块幕布，
不需要腐蚀/连通域/膨胀任何形态学操作。然后算每个像素到种子的距离，软斜坡转权重：

    w = 色相窗(角距离) × max( 1-斜坡(到种子距离, 0, 24), 泛光项, 幕布色匹配项 )

- 真幕布：距离 0 → w=1
- 人物轮廓毛边 / 飘出来的发丝：距离小 → w 平滑过渡
- 头发主体（含受光那一片）：距离大 → w=0（不再窜色）
- **运动模糊的幕布**（头快转时被拖出条纹）：平坦判据失效、距离又远，靠第三项兜住

**斜坡宽度 24 不是随便定的**：红幕版看着自然，是因为「幕布→头发」的过渡跨了约
24px，而且色相不断、只有明度斜坡；换成绿幕之后同样的宽度里色相要跨 120°。
原来取 2→10（只有 8px）在红幕上够用，在绿幕上就是一条硬边 —— 实测扫描线里
权重在 6 个像素内从 0.84 掉到 0.05，飘出来的发丝整根保持红棕色，在绿底上读成
一圈硬轮廓。开到 24 之后发丝跟着变绿、轮廓软下来，和红幕版的观感对齐。

**但斜坡一开宽，就会出现第二个问题：窄的幕布缝隙永远到不了 w=1。**
发卷之间露出来的幕布往往只有 40~50px 宽，两侧各扣掉 24px 的斜坡，中间就只剩
一半权重 —— 看着就是一条暗红。再加上头快速转动时幕布被**拖出条纹**，高通能量
从 0.5 飙到 5.0+，`tex < 0.6` 直接失效，那块连种子都进不去，距离跑到 27~63px。
所以补了第三项「幕布色匹配」：与**最近的种子像素**比颜色，一致就是幕布。
实测到最近幕布色的差：幕布/泄漏恒为 0，头发 p5=69~71，皮肤 p5=89~92 —— 完全不重叠。

走错过的路，记下来免得再走
--------------------------
0. **把斜坡宽度当成「越窄越干净」**：窄斜坡在红幕上没暴露问题，换绿幕后才显形。
   这不是精度问题，是**观感问题** —— 判据是「和原片的过渡宽度对齐」，不是「mask 更准」。
1. **腐蚀 + 连通域筛选**：误判区通过发丝细缝和幕布细连着，而且越腐蚀越碎但去不掉
   （实测腐蚀 1→5px，最大块仍有 1031px）。更糟的是随后的膨胀 2px 会把细丝**重新灌满**。
2. **普通局部标准差当纹理判据**：窗口跨在人物轮廓上会把过渡带算成高纹理，
   mask 沿轮廓内缩一圈、留红边。
3. **高通能量 + 硬阈值**：绿块和红边二选一，没有中间态。
4. **把纹理窗口从 9px 加大到 61px**：毛边带和头发误判区的纹理分布照样重叠。
5. **明度/饱和度斜坡**：真幕布自身横跨 val 0.48~0.99、sat 0.73~1.00，任何全局
   明度/饱和阈值都会在幕布的某一端切出一片「换色不彻底」的灰区。
6. **形态学开运算**（想用「厚=头发、薄=毛边」区分）：能压住大块，但小的受光斑块
   被开运算抹掉后重新变成绿点。

用法
----
    # 先出单帧预览，肉眼确认边缘干净（--crop 放大看头发）
    python scripts/recolor-video-background.py --preview
    python scripts/recolor-video-background.py --preview --at 4.0 --crop 850,0,1750,900

    # 确认后跑全量（会覆盖 frontend/public/mainframe-bg.mp4）
    python scripts/recolor-video-background.py --write

源素材存档：`media-src/mainframe-bg-red.mp4`（HEVC Main 10 / yuv420p10le，1920x1080
24fps 4.04s）。它同时是 `DEFAULT_SRC`，所以不带 `--src` 直接跑就是换色本身；
**千万别指向已换好色的成品**，那会把绿色再转一次。
存档放在 `media-src/` 而不是 `scripts/assets/` —— 后者被外部进程整个清空过两次。

依赖：numpy、Pillow、scipy；ffmpeg 取 imageio-ffmpeg 自带的那份。
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
# 默认源 = 红幕原版（换色的唯一正确输入）。曾经默认指向成品，不带 --src 直接跑
# 会把绿幕再转一次 —— 那是个陷阱，已修。
DEFAULT_SRC = ROOT / "media-src" / "mainframe-bg-red.mp4"
DEFAULT_OUT = ROOT / "frontend" / "public" / "mainframe-bg.mp4"
# 预览图不能放进 frontend/public —— 那里的一切都会被打进 dist 产物
PREVIEW_DIR = ROOT / "scripts" / "assets"

# ---- 色相 ----
BG_HUE = 353.0           # 背景色相中心：实测红幕落在 350~358°，取中值
HUE_SHIFT = 120.0        # 红(353°) → 绿(113°)
HUE_FULL = 9.0           # 角距离 <= 它，色相完全算背景
HUE_ZERO = 15.0          # 角距离 >= 它，完全不算（头发主体 p1=15.1）

# ---- 平坦种子：幕布是一块光滑平面，人物身上的一切都有纹理 ----
TEX_WIN = 9              # 高通能量窗口
TEX_SIGMA = 1.5
TEX_FLAT = 0.6           # 实测：幕布两端 tex9 p99 = 0.47 / 0.56；人物最低 0.65。0.6 正好在缝里
SEED_HUE = 12.0          # 种子还要色相在窗内，避免其他色相的平坦区域被当种子

# ---- 到种子的距离：软斜坡，越靠近幕布越接近「纯背景」 ----
# 斜坡宽度 = 轮廓的视觉过渡宽度。红幕版看着自然，是因为「幕布→头发」跨了 ~24px，
# 而且色相不断、只有明度斜坡。原来的 2→10 只有 8px 物理宽度，红幕上够用，
# 换成绿幕之后同样的 8px 里色相要跨 120°，就成了一条硬边（实测扫描线：
# 权重在 6 个像素内从 0.84 掉到 0.05）。开到 24 才和红幕版的观感对齐。
# 副作用可控：头发主体只 +0.4 绿通道，皮肤被染绿 0.1%（都是轮廓 AA 像素）。
DIST_LO, DIST_HI = 0.0, 24.0

# ---- 受光泛光：头发外沿被红幕打亮的那一圈，是**亮**的，必须一起换色 ----
# 实测轮廓外沿（dist<30、色相在窗内）val p50=0.824，而头发主体 val≈0.32。
# 不处理它的话，人物轮廓会留一圈红边（源素材里它本来是融在红幕里的，看不见）。
GLOW_VAL_LO, GLOW_VAL_HI = 0.60, 0.80
GLOW_SAT_LO, GLOW_SAT_HI = 0.45, 0.58   # 泛光是高饱和红光，防止近灰的亮像素被误换
# 泛光只允许出现在紧贴幕布的一圈里。不加这道门，脸上的**红晕和鼻头**（同样是
# 又亮又红又高饱和，颜色上和泛光完全一样）会被一起染绿 —— 实测脸部这些像素
# 到种子的距离 p5=45.5，而头发外沿的泛光只有 2~15，距离能把两者分开。
GLOW_DIST_LO, GLOW_DIST_HI = 16.0, 34.0

# ---- 幕布色匹配：兜住「运动模糊的幕布」 ----
# 头快速转动时，发卷缝隙里露出来的幕布被拖出条纹，高通能量从 0.5 飙到 5.0+，
# `tex < 0.6` 的平坦判据直接失效 → 那块进不了种子 → 到种子的距离 27~63px
# → 距离项归零 → 在发卷之间留下一条纯幕布红（实测第 25 帧 347px @ (205,25,36)）。
# 但它**颜色**和幕布一模一样，所以补一道颜色判据：与「最近的种子像素颜色」比较。
# 实测（第 25/48/0 帧）到最近幕布色的差：幕布/泄漏恒为 0，头发 p5=69~71，皮肤 p5=89~92
# —— 判据完全不重叠，取 10~32 有 37 以上的余量。
MATCH_LO, MATCH_HI = 10.0, 32.0
FEATHER = 1.0            # 最后高斯羽化


def soft_ramp(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """lo 处取 0、hi 处取 1 的线性斜坡（夹紧）。lo >= hi 时恒为 0。"""
    if hi <= lo:
        return np.zeros_like(x)
    return np.clip((x - lo) / (hi - lo), 0.0, 1.0)


def find_ffmpeg() -> str:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # pragma: no cover
        return "ffmpeg"


def rgb_to_hsv_deg(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """rgb: HxWx3 float 0..255 → (H° 0..360, S 0..1, V 0..1)"""
    f = rgb / 255.0
    mx = f.max(axis=2)
    mn = f.min(axis=2)
    d = mx - mn
    r, g, b = f[:, :, 0], f[:, :, 1], f[:, :, 2]

    hue = np.zeros_like(mx)
    nz = d > 1e-9
    # 用 np.select 分段，避免除零
    safe = np.where(nz, d, 1.0)
    m1 = nz & (mx == r)
    m2 = nz & (mx == g) & ~m1
    m3 = nz & (mx == b) & ~m1 & ~m2
    hue[m1] = ((g - b) / safe)[m1] % 6.0
    hue[m2] = ((b - r) / safe)[m2] + 2.0
    hue[m3] = ((r - g) / safe)[m3] + 4.0
    hue *= 60.0

    sat = np.where(mx > 1e-9, d / np.maximum(mx, 1e-9), 0.0)
    return hue, sat, mx


def hsv_to_rgb(hue: np.ndarray, sat: np.ndarray, val: np.ndarray) -> np.ndarray:
    """H° 0..360, S 0..1, V 0..1 → rgb 0..255"""
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


def highpass_energy(gray: np.ndarray, win: int = TEX_WIN, sigma: float = TEX_SIGMA) -> np.ndarray:
    """高通残差的局部能量：先减去高斯模糊，剩下的就是高频，再算窗口内均方根。

    对「平滑斜坡」不敏感（减去模糊后几乎为 0），只对真正的细结构（发丝、毛边）有响应。
    """
    from scipy.ndimage import gaussian_filter, uniform_filter

    hp = gray - gaussian_filter(gray, sigma, mode="nearest")
    m = uniform_filter(hp, win, mode="nearest")
    m2 = uniform_filter(hp * hp, win, mode="nearest")
    return np.sqrt(np.maximum(m2 - m * m, 0.0))


def background_mask(rgb: np.ndarray) -> np.ndarray:
    """返回 0..1 的软权重：1 = 纯背景，0 = 主体。**全程连续，没有任何硬阈值。**

    判据是「到平坦幕布的距离」，不是颜色也不是单纯纹理（见模块 docstring 的死路清单）：

    1. 幕布是一整块光滑平面（实测 tex9 ≤ 0.56），人物身上任何东西都有纹理（≥ 0.65）。
       取 `tex < 0.6 且色相在窗内` 的像素当**种子**，再滤掉不与画面边缘连通的零星小块。
       种子天然就是整块幕布，不需要任何形态学操作。
    2. 算每个像素到种子的欧氏距离，用软斜坡转成权重。
       幕布距离 0 → w=1；人物轮廓毛边距离小 → w 平滑过渡（不会留硬红边）；
       头发主体（包括被红幕打光、色相已经接近幕布的那一片）距离大 → w=0（不再窜色）。
    3. 色相窗再乘一道，防止其他色相的东西（绿衬衫、肤色）被算进来。
    """
    from scipy import ndimage

    hue, sat, val = rgb_to_hsv_deg(rgb)
    dist = np.abs(hue - BG_HUE)
    dist = np.minimum(dist, 360.0 - dist)          # 环形角距离

    hue_w = 1.0 - soft_ramp(dist, HUE_FULL, HUE_ZERO)

    tex = highpass_energy(rgb.mean(axis=2))
    flat = (tex < TEX_FLAT) & (dist < SEED_HUE)
    labels, _ = ndimage.label(flat)
    edge = np.unique(np.concatenate([labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]]))
    edge = edge[edge != 0]
    seed = np.isin(labels, edge) if edge.size else flat
    # 3x3 闭运算只补种子里的孤立空洞（源片个别帧的幕布噪点会落到阈值外）。
    # 它最多让种子往外长 1px，对 24px 的斜坡没有可测影响；实测第 0 帧幕布角上
    # 只有 14px 拿到 w≈0.915（其余 96 帧全部 1.0000），补不补都看不出来，
    # 留着是为了换素材时不会冒出零星灰点。
    seed = ndimage.binary_closing(seed, np.ones((3, 3), bool))

    d, idx = ndimage.distance_transform_edt(~seed, return_indices=True)
    dist_term = 1.0 - soft_ramp(d, DIST_LO, DIST_HI)

    # 第二项：远离幕布但仍然很亮的高饱和红 —— 那是幕布打在头发上的泛光，
    # 它本来融在红幕里看不见，换成绿幕后会变成一圈红边，所以也要一起换色。
    # 但必须限制在紧贴幕布的一圈内，否则脸上的红晕/鼻头会被一起染绿。
    glow = soft_ramp(val, GLOW_VAL_LO, GLOW_VAL_HI) * soft_ramp(sat, GLOW_SAT_LO, GLOW_SAT_HI)
    glow *= 1.0 - soft_ramp(d, GLOW_DIST_LO, GLOW_DIST_HI)

    # 第三项：颜色与「最近的幕布像素」一致 —— 兜住被运动模糊拖花的幕布，
    # 它的平坦判据失效、距离又远，前两项都够不到（见 MATCH_LO 的注释）。
    nearest = rgb[idx[0], idx[1]]
    delta = np.sqrt(((rgb - nearest) ** 2).sum(axis=2))
    match = 1.0 - soft_ramp(delta, MATCH_LO, MATCH_HI)

    w = hue_w * np.maximum(np.maximum(dist_term, glow), match)

    if FEATHER > 0:
        from scipy.ndimage import gaussian_filter

        w = gaussian_filter(w, FEATHER, mode="nearest")
    return w.astype(np.float32)


def recolor(rgb: np.ndarray, hue_shift: float) -> np.ndarray:
    w = background_mask(rgb)[..., None]
    hue, sat, val = rgb_to_hsv_deg(rgb)
    shifted = hsv_to_rgb((hue + hue_shift) % 360.0, sat, val)
    return rgb * (1.0 - w) + shifted * w


def grab_frame(ffmpeg: str, src: Path, at: float, w: int = 1920, h: int = 1080) -> np.ndarray:
    proc = subprocess.run(
        [ffmpeg, "-v", "error", "-ss", str(at), "-i", str(src), "-frames:v", "1",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, check=True,
    )
    raw = np.frombuffer(proc.stdout, dtype=np.uint8)
    if raw.size % (w * h * 3) != 0:
        for cand_h in (720, 540, 480):
            for cand_w in (1280, 960, 854, 640):
                if raw.size == cand_w * cand_h * 3:
                    w, h = cand_w, cand_h
    return raw[: w * h * 3].reshape(h, w, 3).astype(np.float32)


def parse_crop(text: str | None) -> tuple[int, int, int, int] | None:
    if not text:
        return None
    parts = [int(v) for v in text.split(",")]
    if len(parts) != 4:
        raise SystemExit("--crop 需要 4 个整数：x0,y0,x1,y1")
    return parts[0], parts[1], parts[2], parts[3]


def preview(ffmpeg: str, src: Path, at: float, crop: tuple[int, int, int, int] | None) -> None:
    rgb = grab_frame(ffmpeg, src, at)
    out = np.clip(recolor(rgb, HUE_SHIFT), 0, 255)
    mask = background_mask(rgb)

    before = Image.fromarray(rgb.astype(np.uint8))
    after = Image.fromarray(out.astype(np.uint8))
    mask_img = Image.fromarray((mask * 255).astype(np.uint8)).convert("RGB")

    if crop:
        x0, y0, x1, y1 = crop
        before, after, mask_img = (im.crop((x0, y0, x1, y1)) for im in (before, after, mask_img))

    W = 560
    tiles = [im.resize((W, int(im.height * W / im.width)), Image.LANCZOS)
             for im in (before, after, mask_img)]
    th = tiles[0].height
    canvas = Image.new("RGB", (W * 3 + 24, th + 30), (26, 26, 26))
    from PIL import ImageDraw

    d = ImageDraw.Draw(canvas)
    tag = f" @{at}s" + (f" crop={crop}" if crop else "")
    for i, (t, im) in enumerate(zip(("原始（红幕）", "换色后（绿幕）", "背景 mask"), tiles)):
        x = i * (W + 12)
        canvas.paste(im, (x, 30))
        d.text((x + 8, 8), t + tag, fill=(255, 220, 120))
    out_path = PREVIEW_DIR / "mainframe-recolor-preview.jpg"
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, quality=92)
    print(f"预览已写出：{out_path}")

    # 顺手报一下背景占比，确认 mask 没跑偏
    print(f"背景像素占比：{mask.mean()*100:.1f}%（原始红幕约占 81%）")


def probe_size(ffmpeg: str, src: Path) -> tuple[int, int]:
    """解码一帧、按字节数反推分辨率（不必依赖 ffprobe）。"""
    p = subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(src), "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-frames:v", "1", "-"],
        capture_output=True, check=True,
    )
    size = len(p.stdout)
    for w, h in ((1920, 1080), (1280, 720), (960, 540), (854, 480), (640, 360)):
        if size == w * h * 3:
            return w, h
    raise SystemExit(f"无法从 {size} 字节推断分辨率")


def write_video(ffmpeg: str, src: Path, dst: Path) -> None:
    W, H = probe_size(ffmpeg, src)
    dec = subprocess.Popen(
        [ffmpeg, "-v", "error", "-i", str(src), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE,
    )

    tmp = dst.with_suffix(".recolored.mp4")
    enc = subprocess.Popen(
        [ffmpeg, "-y", "-v", "error",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", "24", "-i", "-",
         "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p",
         "-crf", "21", "-preset", "slow", "-tune", "animation",
         # 全 I 帧：前端 scrub 时每次 seek 都不必回溯解码，这是消除卡顿的关键
         "-g", "1", "-keyint_min", "1", "-sc_threshold", "0",
         "-an", "-movflags", "+faststart", str(tmp)],
        stdin=subprocess.PIPE,
    )

    n = 0
    fb = W * H * 3
    while True:
        raw = dec.stdout.read(fb)
        if len(raw) < fb:
            break
        rgb = np.frombuffer(raw, dtype=np.uint8).reshape(H, W, 3).astype(np.float32)
        out = np.clip(recolor(rgb, HUE_SHIFT), 0, 255).astype(np.uint8)
        enc.stdin.write(out.tobytes())
        n += 1
        if n % 10 == 0:
            print(f"  已处理 {n} 帧", flush=True)

    dec.stdout.close()
    dec.wait()
    enc.stdin.close()
    enc.wait()
    # Windows 上 os.replace 覆盖不了被占用的文件（dev server / 浏览器正在读它），
    # 会抛 WinError 5；先删再改名才稳。踩过一次，别改回去。
    if dst.exists():
        try:
            dst.unlink()
        except PermissionError:
            raise SystemExit(
                f"无法覆盖 {dst}：文件正被占用。\n"
                "请先关掉开着 #/mainframe 的浏览器标签（或停掉 dev server）再重跑。"
            )
    tmp.rename(dst)
    print(f"完成：{n} 帧 {W}x{H} → {dst}（{dst.stat().st_size/1024/1024:.1f} MB）")

    # 顺手重建海报。海报是视频未就绪时的垫底层，视频一换就必须跟着换，
    # 否则页面会拿旧颜色的静态帧闪一下。别漏。
    poster = dst.with_name("mainframe-poster.jpg")
    subprocess.run(
        [ffmpeg, "-y", "-v", "error", "-ss", "2.0", "-i", str(dst),
         "-frames:v", "1", "-q:v", "4", str(poster)],
        check=True,
    )
    print(f"海报已重建：{poster}（{poster.stat().st_size/1024:.0f} KB）")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--preview", action="store_true", help="只输出单帧对比图")
    ap.add_argument("--write", action="store_true", help="跑全量并覆盖输出文件")
    ap.add_argument("--at", type=float, default=2.0, help="预览取第几秒")
    ap.add_argument("--crop", type=str, default=None, help="预览裁剪 x0,y0,x1,y1（放大看细节）")
    args = ap.parse_args()

    if not args.src.exists():
        print(f"找不到源视频：{args.src}")
        return 1
    ffmpeg = find_ffmpeg()

    if args.preview:
        preview(ffmpeg, args.src, args.at, parse_crop(args.crop))
        return 0
    if args.write:
        write_video(ffmpeg, args.src, args.out)
        return 0
    ap.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
