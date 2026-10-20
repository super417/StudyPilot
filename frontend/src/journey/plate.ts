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

export interface PhaseSignAnchor {
  name: string;
  startDate: string;
  delta: number;
  fx: number;
  fy: number;
}

/** 阶段第一天正好落在某个果实槽上时，才挂木牌。 */
export function visiblePhaseSigns(
  phases: { name: string; startDate: string }[],
  days: { date: string }[],
  todayIndex: number,
  dayShift: number,
): PhaseSignAnchor[] {
  if (todayIndex < 0) return [];
  const signs: PhaseSignAnchor[] = [];
  for (const phase of phases) {
    const index = days.findIndex((day) => day.date === phase.startDate);
    if (index < 0) continue;
    const delta = index - todayIndex - dayShift;
    const slot = PLATE_SLOTS.find((item) => item.delta === delta);
    if (!slot) continue;
    signs.push({ name: phase.name, startDate: phase.startDate, delta, fx: slot.fx, fy: slot.fy });
  }
  return signs;
}

/** 木牌让开果实热区；有旗标时放到旗标对侧，贴边就翻面。 */
export function phaseSignSide(fruitX: number, viewW: number, hasOutwardTag: boolean): 'left' | 'right' {
  const outward: 'left' | 'right' = fruitX > viewW / 2 ? 'right' : 'left';
  let side: 'left' | 'right' = hasOutwardTag ? (outward === 'right' ? 'left' : 'right') : outward;
  const signW = 112;
  const gap = 48;
  if (side === 'right' && fruitX + gap + signW > viewW - 8) side = 'left';
  if (side === 'left' && fruitX - gap - signW < 8) side = 'right';
  return side;
}

/** 从藤的下端爬到今天：只走 delta ≤ 0 的槽，y 从大到小。 */
export function climbPoints(viewW: number, viewH: number): { x: number; y: number }[] {
  return PLATE_SLOTS.filter((slot) => slot.delta <= 0)
    .slice()
    .sort((a, b) => b.fy - a.fy)
    .map((slot) => coverPoint(slot.fx, slot.fy, viewW, viewH));
}

/** 按折线插值。t=0 在第一点，t=1 在最后一点。 */
export function pointAlong(points: { x: number; y: number }[], t: number): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1 || t <= 0) return points[0];
  if (t >= 1) return points[points.length - 1];
  const segments = points.length - 1;
  const scaled = t * segments;
  const index = Math.min(segments - 1, Math.floor(scaled));
  const local = scaled - index;
  const from = points[index];
  const to = points[index + 1];
  return { x: from.x + (to.x - from.x) * local, y: from.y + (to.y - from.y) * local };
}
