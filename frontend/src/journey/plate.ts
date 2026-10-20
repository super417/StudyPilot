/** 效果图豆藤地图的像素尺寸。节点用这张图上的比例，再按 cover 算到视口里。 */
export const PLATE_W = 1280;
export const PLATE_H = 720;

/**
 * 效果图里果实的锚点。fy 越大越靠下，对应更早的日期。
 * delta 0 是今天，负数是过去，正数是未来。
 */
export const PLATE_SLOTS = [
  { fx: 0.498, fy: 0.803, delta: -3 },
  { fx: 0.62, fy: 0.603, delta: -2 },
  { fx: 0.623, fy: 0.464, delta: -1 },
  { fx: 0.451, fy: 0.381, delta: 0 },
  { fx: 0.51, fy: 0.242, delta: 1 },
  { fx: 0.501, fy: 0.125, delta: 2 },
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
 * 云的左边界取未解锁关卡纵向范围内的最小值，不把整张图的左缘写死。
 */
export const VINE_LEFT_STEP = 8;
export const VINE_LEFT = [
  710, 702, 709, 592, 594, 644, 592, 586, 587, 588, 625, 678, 677, 651, 562, 557, 554, 553, 570, 570, 569, 568, 568, 569, 571, 588, 586, 584, 583, 584, 587, 588, 590, 592, 594, 565, 558, 557, 602, 604, 476, 481, 492, 527, 522, 520, 518, 518, 518, 519, 521, 501, 496, 495, 495, 524, 517, 508, 500, 358, 357, 359, 362, 370, 423, 449, 456, 451, 448, 397, 394, 388, 380, 380, 380, 380, 383, 386, 390, 395, 402, 375, 371, 368, 360, 337, 297, 292, 290, 290,
] as const;

/** 效果图 y 范围内，藤的最左像素。 */
export function vineLeftPlate(y0: number, y1: number): number {
  const start = Math.max(0, Math.floor(Math.min(y0, y1) / VINE_LEFT_STEP));
  const end = Math.min(VINE_LEFT.length - 1, Math.ceil(Math.max(y0, y1) / VINE_LEFT_STEP));
  let left = Number.POSITIVE_INFINITY;
  for (let index = start; index <= end; index += 1) {
    const value = VINE_LEFT[index];
    if (value >= 0 && value < left) left = value;
  }
  return Number.isFinite(left) ? left : 0;
}

/**
 * 未解锁关卡这一段的云。
 * 左边界 = 这些关卡纵向范围内藤的最左像素；右边界 = 地图右缘（视口右缘，地图 cover 铺满）。
 * 纵向包住这些关卡，并留出锁链和云瓣的厚度。换一批关卡，左右和上下都会变。
 */
export function cloudFrameForSegment(
  nodes: Array<{ x: number; y: number }>,
  viewW: number,
  viewH: number,
): CloudGateFrame | null {
  if (nodes.length === 0 || viewW < 80 || viewH < 80) return null;
  const scale = Math.max(viewW / PLATE_W, viewH / PLATE_H);
  const offsetX = (PLATE_W * scale - viewW) / 2;
  const offsetY = (PLATE_H * scale - viewH) / 2;
  const plateYs = nodes.map((node) => (node.y + offsetY) / scale);
  const leftPlate = vineLeftPlate(Math.min(...plateYs) - 36, Math.max(...plateYs) + 36);
  const left = Math.max(0, Math.min(viewW - 120, Math.round(leftPlate * scale - offsetX)));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxY = Math.max(...nodes.map((node) => node.y));
  const span = Math.max(72, maxY - minY);
  const padY = Math.max(56, span * 0.62);
  const top = Math.max(0, Math.round(minY - padY));
  const bottom = Math.min(viewH, Math.round(maxY + padY * 0.72));
  const height = Math.max(108, bottom - top);
  return {
    top,
    left,
    width: viewW - left,
    height,
    poleX: Math.round(Math.min(viewW - 96, left + (viewW - left) * 0.62)),
    poleY: Math.round(height * 0.42),
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
