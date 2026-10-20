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
 * 阶段门这一段藤的中心线，效果图像素。
 * 采样自地图上闸门所在的右侧藤段（约 fy 0.48–0.62），不是整株藤，也不是视口宽度。
 */
export const GATE_VINE_PATH = [
  { x: 841, y: 344 },
  { x: 838, y: 356 },
  { x: 772, y: 376 },
  { x: 704, y: 392 },
  { x: 805, y: 408 },
  { x: 838, y: 420 },
  { x: 751, y: 436 },
  { x: 718, y: 448 },
] as const;

/** 中心线向外的余量：盖住藤干厚度，再留一圈薄边。单位是效果图像素。 */
const GATE_VINE_PAD_X = 58;
const GATE_VINE_PAD_Y = 26;

/**
 * 云层跟这一段藤的包围盒走。
 * 横向 = 路径 minX..maxX 再加左右余量；纵向同理。宽度随这段藤在画面上的长短变化，不铺满屏幕。
 * 旗杆落在云团右侧厚实处。
 */
export function cloudGateFrame(viewW: number, viewH: number): CloudGateFrame {
  const scale = Math.max(viewW / PLATE_W, viewH / PLATE_H);
  const offsetX = (PLATE_W * scale - viewW) / 2;
  const offsetY = (PLATE_H * scale - viewH) / 2;
  const xs = GATE_VINE_PATH.map((point) => point.x * scale - offsetX);
  const ys = GATE_VINE_PATH.map((point) => point.y * scale - offsetY);
  const marginX = GATE_VINE_PAD_X * scale;
  const marginY = GATE_VINE_PAD_Y * scale;
  let left = Math.min(...xs) - marginX;
  let right = Math.max(...xs) + marginX;
  let top = Math.min(...ys) - marginY;
  let bottom = Math.max(...ys) + marginY;
  const sky = Math.min(viewW * 0.06, 48);
  if (right - left > viewW - sky * 2) {
    const mid = (left + right) / 2;
    const half = (viewW - sky * 2) / 2;
    left = mid - half;
    right = mid + half;
  }
  left = Math.max(sky, left);
  right = Math.min(viewW - sky, right);
  top = Math.max(0, top);
  const width = Math.max(96, Math.round(right - left));
  const height = Math.max(72, Math.round(bottom - top));
  return {
    top: Math.round(top),
    left: Math.round(left),
    width,
    height,
    poleX: Math.round(left + width * 0.74),
    poleY: Math.round(height * 0.46),
  };
}

/** 点是否落在云团厚实核心里。相邻节点仍画在云层上面，这里只描述核心范围。 */
export function nodeUnderCloud(nodeX: number, nodeY: number, frame: Pick<CloudGateFrame, 'top' | 'left' | 'width' | 'height'>): boolean {
  const yHit = nodeY >= frame.top + frame.height * 0.2 && nodeY <= frame.top + frame.height * 0.78;
  const xHit = nodeX >= frame.left + frame.width * 0.14 && nodeX <= frame.left + frame.width * 0.86;
  return yHit && xHit;
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
