#!/usr/bin/env bash
# 把 Mainframe 背景视频转成浏览器可解码的 H.264/avc1 8-bit，并抽一帧静态海报。
#
# 为什么要转：素材站给的是 HEVC Main10（10-bit H.265）。Chrome / Edge / Firefox
# 都不解码它，<video> 只会抛 error 并停在黑帧上 —— 页面表现为「展开后一片黑」。
# 判断当前素材编码：ffmpeg -i frontend/public/mainframe-bg.mp4
#   可播 → "h264 (High) (avc1), yuv420p"
#   不可播 → "hevc (Main 10) (hvc1), yuv420p10le"
#
# 用法：
#   bash scripts/transcode-mainframe-video.sh <源视频> [ffmpeg 路径]
# 例：
#   bash scripts/transcode-mainframe-video.sh ~/Downloads/source.mp4
#   bash scripts/transcode-mainframe-video.sh source.mp4 /c/ffmpeg/bin/ffmpeg.exe
#
# 本机没装 ffmpeg 时，可以借 Python 的一份现成二进制：
#   python -m pip install imageio-ffmpeg
#   python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"

set -euo pipefail

SRC="${1:?用法: transcode-mainframe-video.sh <源视频> [ffmpeg 路径]}"
FFMPEG="${2:-ffmpeg}"
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/frontend/public"

# -pix_fmt yuv420p      8-bit 4:2:0，浏览器唯一普遍支持的像素格式（10-bit 一律解不了）
# -g 1                  全 I 帧：鼠标 scrub 时每次 seek 都不必回溯解码，这是消除卡顿的关键。
#                       （早先这里是 -g 8，seek 时仍要回溯最多 7 帧，快滑会顿。）
# -movflags +faststart  把 moov 前置，首帧不必等整个文件下完
# -an                   静音：背景视频只做视觉，不带音轨
"$FFMPEG" -y -hide_banner \
  -i "$SRC" \
  -c:v libx264 -profile:v high -level 4.1 -pix_fmt yuv420p \
  -crf 23 -preset slow -tune animation \
  -g 1 -keyint_min 1 -sc_threshold 0 \
  -an -movflags +faststart \
  "$OUT_DIR/mainframe-bg.mp4"

# 海报：取 50% 处的中性帧（人物视线朝前）。视频未就绪或解码失败时垫在底层，避免黑屏。
"$FFMPEG" -y -hide_banner -loglevel error \
  -ss 2.0 -i "$OUT_DIR/mainframe-bg.mp4" \
  -frames:v 1 -q:v 4 "$OUT_DIR/mainframe-poster.jpg"

echo "done -> $OUT_DIR/mainframe-bg.mp4"
