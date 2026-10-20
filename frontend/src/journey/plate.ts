/** 效果图豆藤地图的像素尺寸。节点用这张图上的比例，再按 cover 算到视口里。 */
export const PLATE_W = 1280;
export const PLATE_H = 720;

/**
 * 底图上关卡果实的锚点（底图比例坐标）。fy 越大越靠下，对应更早的日期。
 * delta 0 是今天，负数是过去，正数是未来。
 * 每 3 颗一段，沿藤的螺旋条从左下斜向右上；一段走完回到左下开始下一段（之字形）。
 * segment 是段号，从下往上 0、1、2。
 */
export const PLATE_SLOTS = [
  { fx: 0.4414, fy: 0.7986, delta: -4, segment: 0 },
  { fx: 0.5156, fy: 0.7569, delta: -3, segment: 0 },
  { fx: 0.5898, fy: 0.7111, delta: -2, segment: 0 },
  { fx: 0.4281, fy: 0.5903, delta: -1, segment: 1 },
  { fx: 0.5023, fy: 0.5444, delta: 0, segment: 1 },
  { fx: 0.5797, fy: 0.4972, delta: 1, segment: 1 },
  { fx: 0.4922, fy: 0.3472, delta: 2, segment: 2 },
  { fx: 0.5406, fy: 0.3028, delta: 3, segment: 2 },
  { fx: 0.6000, fy: 0.2569, delta: 4, segment: 2 },
] as const;

export interface CloudGateFrame {
  top: number;
  left: number;
  width: number;
  height: number;
  poleX: number;
  poleY: number;
}

/**
 * 效果图上每 8 像素一行，这一行藤的最左像素。-1 表示这一行没有藤。
 * 云的左右边界取这一段藤的左右缘，再各溢出一点，不铺到视口右缘。
 */
export const VINE_LEFT_STEP = 8;
export const VINE_LEFT = [
  710, 702, 709, 592, 594, 644, 592, 586, 587, 588, 625, 678, 677, 651, 562, 557, 554, 553, 570, 570, 569, 568, 568, 569, 571, 588, 586, 584, 583, 584, 587, 588, 590, 592, 594, 565, 558, 557, 602, 604, 476, 481, 492, 527, 522, 520, 518, 518, 518, 519, 521, 501, 496, 495, 495, 524, 517, 508, 500, 358, 357, 359, 362, 370, 423, 449, 456, 451, 448, 397, 394, 388, 380, 380, 380, 380, 383, 386, 390, 395, 402, 375, 371, 368, 360, 337, 297, 292, 290, 290,
] as const;

/** 同一行藤的最右像素。和 VINE_LEFT 一样每 8 像素一行。 */
export const VINE_RIGHT = [
  999, 993, 985, 983, 989, 1004, 1004, 995, 945, 940, 939, 941, 938, 936, 933, 927, 919, 920, 914, 921, 927, 950, 950, 945, 939, 935, 934, 930, 923, 911, 885, 897, 897, 897, 906, 912, 920, 917, 881, 882, 882, 880, 879, 881, 879, 874, 870, 874, 876, 877, 877, 876, 883, 870, 915, 953, 958, 967, 832, 861, 964, 956, 857, 856, 854, 853, 856, 859, 859, 867, 866, 886, 900, 930, 935, 936, 935, 932, 925, 915, 906, 877, 890, 951, 957, 959, 959, 959, 954, 945,
] as const;

function vineEdge(samples: readonly number[], y0: number, y1: number, pick: 'min' | 'max'): number {
  const start = Math.max(0, Math.floor(Math.min(y0, y1) / VINE_LEFT_STEP));
  const end = Math.min(samples.length - 1, Math.ceil(Math.max(y0, y1) / VINE_LEFT_STEP));
  let edge = pick === 'min' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  for (let index = start; index <= end; index += 1) {
    const value = samples[index];
    if (value < 0) continue;
    edge = pick === 'min' ? Math.min(edge, value) : Math.max(edge, value);
  }
  if (!Number.isFinite(edge)) return pick === 'min' ? 0 : PLATE_W;
  return edge;
}

/** 效果图 y 范围内，藤的最左像素。 */
export function vineLeftPlate(y0: number, y1: number): number {
  return vineEdge(VINE_LEFT, y0, y1, 'min');
}

/** 效果图 y 范围内，藤的最右像素。 */
export function vineRightPlate(y0: number, y1: number): number {
  return vineEdge(VINE_RIGHT, y0, y1, 'max');
}

/**
 * 未解锁关卡这一段的雾带。
 * 左 = 这段藤最左再溢出一点，右 = 这段藤最右再溢出一点，不铺满视口。
 * 纵向包住这些关卡。floorY 是下方第一颗已解锁节点，雾底停在它上面。
 */
export function cloudFrameForSegment(
  nodes: Array<{ x: number; y: number }>,
  viewW: number,
  viewH: number,
  floorY?: number,
): CloudGateFrame | null {
  if (nodes.length === 0 || viewW < 80 || viewH < 80) return null;
  const scale = Math.max(viewW / PLATE_W, viewH / PLATE_H);
  const offsetX = (PLATE_W * scale - viewW) / 2;
  const offsetY = (PLATE_H * scale - viewH) / 2;
  const plateYs = nodes.map((node) => (node.y + offsetY) / scale);
  const bandTop = Math.min(...plateYs) - 28;
  const bandBottom = Math.max(...plateYs) + 28;
  const overflow = 42;
  const left = Math.max(8, Math.round((vineLeftPlate(bandTop, bandBottom) - overflow) * scale - offsetX));
  const right = Math.min(viewW - 8, Math.round((vineRightPlate(bandTop, bandBottom) + overflow) * scale - offsetX));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxY = Math.max(...nodes.map((node) => node.y));
  const span = Math.max(88, maxY - minY);
  const header = 36;
  let top = Math.round(minY - Math.max(78, span * 0.9));
  top = Math.max(header, Math.min(top, Math.round(minY - 24)));
  let bottom = Math.round(maxY + Math.max(70, span * 0.75));
  if (floorY != null) bottom = Math.min(bottom, Math.round(floorY - 40));
  bottom = Math.max(bottom, Math.round(maxY + 40));
  bottom = Math.min(viewH - 96, bottom);
  const height = Math.max(140, bottom - top);
  const width = Math.max(180, right - left);
  return {
    top,
    left,
    width,
    height,
    poleX: Math.round(left + width * 0.62),
    poleY: Math.round(height * 0.3),
  };
}

/** object-fit: cover 时，效果图比例点落到视口坐标。 */
export function coverPoint(fx: number, fy: number, viewW: number, viewH: number): { x: number; y: number } {
  const scale = Math.max(viewW / PLATE_W, viewH / PLATE_H);
  const offsetX = (PLATE_W * scale - viewW) / 2;
  const offsetY = (PLATE_H * scale - viewH) / 2;
  return {
    x: fx * PLATE_W * scale - offsetX,
    y: fy * PLATE_H * scale - offsetY,
  };
}
