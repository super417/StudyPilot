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
  height: number;
  poleX: number;
  poleY: number;
}

/**
 * 阶段云门盖住右侧槽位（演示默认是 10-17）。
 * 旗杆底端的视口坐标等于该槽位，旗面从云里戳出来。
 */
export function cloudGateFrame(viewW: number, viewH: number): CloudGateFrame {
  const slot = PLATE_SLOTS.find((item) => item.delta === -2) ?? PLATE_SLOTS[1];
  const at = coverPoint(slot.fx, slot.fy, viewW, viewH);
  const height = Math.max(200, Math.round(viewH * 0.24));
  const poleY = Math.round(height * 0.42);
  return {
    top: Math.round(at.y - poleY),
    height,
    poleX: Math.round(at.x),
    poleY,
  };
}

/** 节点中心落在云核里时，日期和星星要藏起来，也不能点。 */
export function nodeUnderCloud(nodeY: number, frame: Pick<CloudGateFrame, 'top' | 'height'>): boolean {
  return nodeY >= frame.top - 56 && nodeY <= frame.top + frame.height * 0.78;
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
