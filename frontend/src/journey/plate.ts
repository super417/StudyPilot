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

/** 效果图上这一段藤干的中心和宽度。云团按 2.9 倍藤干宽来，不铺满屏幕。 */
const PLATE_VINE_FX = 0.551;
const PLATE_VINE_FY = 0.6;
const PLATE_VINE_W = 72;

/**
 * 局部云团：宽约 2.9 倍藤干且不超过视口 42%，高约 0.55 倍云宽。
 * 云心贴藤段中心，左右各留至少 28% 天空。旗杆落在云团厚实处。
 */
export function cloudGateFrame(viewW: number, viewH: number): CloudGateFrame {
  const scale = Math.max(viewW / PLATE_W, viewH / PLATE_H);
  const vine = coverPoint(PLATE_VINE_FX, PLATE_VINE_FY, viewW, viewH);
  const sky = viewW * 0.28;
  let width = Math.round(Math.min(2.9 * PLATE_VINE_W * scale, viewW * 0.42, viewW - sky * 2));
  width = Math.max(96, width);
  const height = Math.round(width * 0.55);
  const half = width / 2;
  const minCenter = sky + half;
  const maxCenter = viewW - sky - half;
  const center = minCenter <= maxCenter ? Math.min(maxCenter, Math.max(minCenter, vine.x)) : viewW / 2;
  const left = Math.round(center - half);
  const top = Math.round(vine.y - height * 0.62);
  return {
    top,
    left,
    width,
    height,
    poleX: Math.round(left + width * 0.76),
    poleY: Math.round(height * 0.46),
  };
}

/** 节点中心落在这块云团里时，日期和星星要藏起来，也不能点。 */
export function nodeUnderCloud(nodeX: number, nodeY: number, frame: Pick<CloudGateFrame, 'top' | 'left' | 'width' | 'height'>): boolean {
  const yHit = nodeY >= frame.top - 36 && nodeY <= frame.top + frame.height * 0.8;
  const xHit = nodeX >= frame.left + frame.width * 0.06 && nodeX <= frame.left + frame.width * 0.98;
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
