"""把效果图底板里画死的日期、星星、旧木牌和底部拼接缝抹掉，另存 map-plate-clean.jpg。

原图 map-plate.jpg 不动。用法：python scripts/clean_journey_plate.py
"""
import subprocess
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1] / 'frontend/src/assets/journey'
SRC = ROOT / 'map-plate.jpg'
DST = ROOT / 'map-plate-clean.jpg'

# 画死的大号日期 + 星星行（x0, y0, x1, y1），只抹框内不是藤绿的像素。
LABELS = [
    (790, 92, 866, 138),   # 10-20 / 10-20
    (766, 188, 834, 228),  # 10-17
    (661, 238, 729, 278),  # 10-18
    (754, 286, 820, 324),  # 10-17
    (611, 343, 679, 380),  # 10-16 紫
    (746, 380, 814, 420),  # 10-16
    (618, 434, 686, 473),  # 10-14
    (594, 534, 662, 573),  # 10-13
    (596, 142, 678, 168),  # 头像下的星
    (604, 600, 676, 638),  # 底部 10-14
    (578, 688, 652, 720),  # 底部 10-13
]
# 旧木牌所在的行。藤右缘在这些行里按上下没被牌子挡住的行插值，
# 缘左只用藤补、缘右只用天空补，再按缘羽化 2px 拼回去，避免藤色糊进天空。
SIGN_ROWS = (380, 692)
SIGN_X = (800, 1050)
SKY_SHIFT = 200
EDGE_KNOTS = [(380, 874), (404, 877), (420, 874), (480, 856), (540, 860), (600, 855), (650, 876), (668, 880), (692, 878)]
# 底部旧拼接留下的硬边天空块。
SEAMS = [(664, 262, 728, 284), (752, 596, 800, 632), (436, 596, 484, 718), (436, 698, 850, 720), (436, 594, 600, 606), (662, 594, 850, 606), (826, 596, 852, 720)]
# 底部：除了旧大按钮那块，其余用最初效果图（提交 64996d5）的原像素，
# 按钮那块用现底板里接上的豆蔓，泊松融合进去，边上不留硬缝。
ORIGINAL = '64996d5'
BUTTON = (440, 600, 846, 714)
BOTTOM_FROM = 586


def erase_signs(img: np.ndarray, green: np.ndarray, done: np.ndarray, sky_ok: np.ndarray) -> np.ndarray:
    y0, y1 = SIGN_ROWS
    x0, x1 = SIGN_X
    ys = np.arange(y0, y1)
    kx, ky = zip(*[(x, y) for y, x in EDGE_KNOTS])
    edge = np.interp(ys, ky, kx)
    h, w = img.shape[:2]
    cols = np.arange(w)[None, :]
    right = np.zeros((h, w), bool)
    right[y0:y1] = cols >= edge[:, None]
    region = np.zeros((h, w), bool)
    region[y0:y1, x0:x1] = True
    board = region & ~right & ~green
    vine_mask = ((board | (region & right)) * 255).astype(np.uint8)
    vine_mask = cv2.dilate(vine_mask, np.ones((3, 3), np.uint8))
    vine = cv2.inpaint(img, vine_mask, 7, cv2.INPAINT_TELEA)
    # 天空：从右边同一高度的干净天空平移过来，四周羽化接回原图。
    sky = img.copy()
    shift = SKY_SHIFT
    sky[y0:y1, x0:x1] = img[y0:y1, x0 + shift:x1 + shift]
    feather = np.ones((h, w), np.float32)
    yy = np.arange(h)[:, None].astype(np.float32)
    xx = cols.astype(np.float32)
    feather *= np.clip((yy - y0) / 30, 0, 1) * np.clip((y1 - yy) / 30, 0, 1)
    feather *= np.clip((x1 - xx) / 50, 0, 1)
    sky = (sky * feather[..., None] + img * (1 - feather[..., None]))
    # 右缘以外原本就是天空的像素保留原图，只有牌子、断叶处换成平移的天空
    dist = np.zeros((h, w), np.float32)
    dist[y0:y1] = (cols - edge[:, None]).astype(np.float32)
    alpha = np.clip((dist + 1.0) / 2.5, 0, 1)[..., None]
    alpha[~region] = 0
    mixed = vine * (1 - alpha) + sky * alpha
    out = img.copy()
    out[region] = mixed[region].astype(np.uint8)
    # 右下那根卷须是真的藤，留原图
    tendril = np.zeros((h, w), bool)
    tendril[640:y1, 915:x1] = green[640:y1, 915:x1]
    tendril = cv2.dilate(tendril.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    out[tendril] = img[tendril]
    done[region & right] = 255
    return out


def rebuild_bottom(img: np.ndarray) -> np.ndarray:
    raw = subprocess.run(
        ['git', 'show', f'{ORIGINAL}:frontend/src/assets/journey/map-plate.jpg'],
        cwd=ROOT.parents[3], capture_output=True, check=True,
    ).stdout
    orig = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    out = img.copy()
    out[BOTTOM_FROM:] = orig[BOTTOM_FROM:]
    # 接缝处 10px 羽化
    for i in range(10):
        y = BOTTOM_FROM + i
        a = (i + 1) / 11
        out[y] = (img[y] * (1 - a) + orig[y] * a).astype(np.uint8)
    x0, y0, x1, y1 = BUTTON
    patch = img[y0 - 6:y1 + 6, x0 - 6:x1 + 6]
    m = np.zeros(patch.shape[:2], np.uint8)
    cv2.rectangle(m, (3, 3), (m.shape[1] - 4, m.shape[0] - 4), 255, -1)
    center = ((x0 + x1) // 2, (y0 + y1) // 2)
    return cv2.seamlessClone(patch, out, m, center, cv2.NORMAL_CLONE)


# 画死的果实、头像、旧标签旗、金环、提示气泡（x0, y0, x1, y1）。
# 关卡果实只由 DOM 在槽位上画，这些全部抹掉。
OBJECTS = [
    (590, 50, 696, 152),   # 头像
    (592, 160, 678, 240),  # 头像下彩果
    (798, 128, 858, 184),  # 右上小绿果
    (766, 222, 830, 290),  # 绿果
    (662, 276, 726, 340),  # 中间绿果
    (758, 318, 818, 380),  # 彩果
    (528, 222, 622, 352, 'patch'),  # 顺延/懒散旗和旗杆
    (574, 344, 692, 436),  # 金环、香蕉、棕果
    (750, 418, 810, 480),  # 彩果
    (620, 468, 686, 530),  # 灰罐
    (598, 560, 660, 616),  # 彩果
    (606, 628, 676, 696),  # 底部灰罐
    (744, 670, 766, 692),  # 小黄点
    (342, 120, 572, 210, 'patch'),  # 画死的提示气泡
]


def _ring(img: np.ndarray, box: tuple[int, int, int, int], pad: int) -> np.ndarray:
    x0, y0, x1, y1 = box
    outer = img[y0 - pad:y1 + pad, x0 - pad:x1 + pad].astype(np.float32)
    m = np.ones(outer.shape[:2], bool)
    m[pad:-pad, pad:-pad] = False
    return outer[m]


def erase_objects(img: np.ndarray) -> np.ndarray:
    """藤身中间的果实用 Telea 顺着藤的明暗补平；
    贴着藤边/天空的（旗、气泡）从附近纹路最接近的位置整块借过来再泊松融合，保住藤边。"""
    soft = np.zeros(img.shape[:2], np.uint8)
    for item in OBJECTS:
        if len(item) == 4:
            x0, y0, x1, y1 = item
            cv2.ellipse(soft, ((x0 + x1) // 2, (y0 + y1) // 2), ((x1 - x0) // 2 + 4, (y1 - y0) // 2 + 4), 0, 0, 360, 255, -1)
    # 只用藤色补：附近的天空像素也临时当成未知，补完再把天空原样放回，免得蓝色渗进藤里。
    b, g, r = [img[:, :, i].astype(int) for i in range(3)]
    sky = (b > r + 25) & (b >= g - 5) & ~((g > r + 12) & (g > b + 12))
    near = cv2.dilate(soft, np.ones((61, 61), np.uint8)).astype(bool)
    hide = soft.copy()
    hide[near & sky] = 255
    out = cv2.inpaint(img, hide, 15, cv2.INPAINT_TELEA)
    keep = near & sky & ~soft.astype(bool)
    out[keep] = img[keep]
    return erase_patches(out, [tuple(item[:4]) for item in OBJECTS if len(item) == 5])


def erase_patches(img: np.ndarray, boxes: list) -> np.ndarray:
    out = img.copy()
    h, w = img.shape[:2]
    pad = 14
    done: list[tuple[int, int, int, int]] = []
    for box in boxes:
        x0, y0, x1, y1 = box
        bw, bh = x1 - x0, y1 - y0
        target = _ring(out, box, pad)
        best = None
        for dy in range(-220, 221, 6):
            for dx in range(-220, 221, 6):
                if abs(dx) < bw * 0.9 and abs(dy) < bh * 0.9:
                    continue
                sx0, sy0 = x0 + dx, y0 + dy
                # 顶部 70px 是画死的旧状态条，不从那里借
                if sx0 - pad < 0 or sy0 - pad < 70 or sx0 + bw + pad > w or sy0 + bh + pad > h:
                    continue
                src = (sx0, sy0, sx0 + bw, sy0 + bh)
                hit = False
                for ox0, oy0, ox1, oy1 in boxes:
                    if (ox0, oy0, ox1, oy1) in done:
                        continue
                    if sx0 < ox1 + 6 and sx0 + bw > ox0 - 6 and sy0 < oy1 + 6 and sy0 + bh > oy0 - 6:
                        hit = True
                        break
                if hit:
                    continue
                score = float(np.mean((_ring(out, src, pad) - target) ** 2))
                if best is None or score < best[0]:
                    best = (score, sx0, sy0)
        assert best is not None
        _, sx0, sy0 = best
        patch = out[sy0 - pad:sy0 + bh + pad, sx0 - pad:sx0 + bw + pad].copy()
        m = np.zeros(patch.shape[:2], np.uint8)
        cv2.ellipse(m, (patch.shape[1] // 2, patch.shape[0] // 2), (patch.shape[1] // 2 - 2, patch.shape[0] // 2 - 2), 0, 0, 360, 255, -1)
        center = (x0 + bw // 2, y0 + bh // 2)
        out = cv2.seamlessClone(patch, out, m, center, cv2.NORMAL_CLONE)
        done.append(box)
    return out


def main() -> None:
    img = rebuild_bottom(cv2.imread(str(SRC)))
    b, g, r = [img[:, :, i].astype(int) for i in range(3)]
    green = (g > r + 12) & (g > b + 12)
    sky = (b > r + 25) & (b >= g - 5) & ~green
    # 天空里离牌子/断叶足够远的像素才算干净
    dirty = cv2.dilate((~sky).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    sky_clean = sky & ~dirty
    mask = np.zeros(img.shape[:2], np.uint8)
    for x0, y0, x1, y1 in LABELS:
        sub = ~green[y0:y1, x0:x1]
        mask[y0:y1, x0:x1] |= sub.astype(np.uint8) * 255
    for x0, y0, x1, y1 in SEAMS:
        mask[y0:y1, x0:x1] = 255
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8), iterations=2)
    out = cv2.inpaint(img, mask, 9, cv2.INPAINT_TELEA)
    out = erase_signs(out, green, mask, sky_clean)
    out = erase_objects(out)
    # 补过的地方加一点和周围一样的细噪点，免得显得太平。
    noise = np.random.default_rng(7).normal(0, 2.2, img.shape)
    soft = cv2.GaussianBlur(mask, (0, 0), 3)[..., None] / 255.0
    out = np.clip(out + noise * soft, 0, 255).astype(np.uint8)
    cv2.imwrite(str(DST), out, [cv2.IMWRITE_JPEG_QUALITY, 92])
    cv2.imwrite('/workspace/skytree/round24/work/mask.png', mask)


if __name__ == '__main__':
    main()
