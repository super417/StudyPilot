import { addDaysISO } from '@/lib/dates';

import { tasksUntilFourStars } from './stars';
import type { JourneyDay, JourneyPhase, JourneyResponse, JourneyTag } from './types';

export const DESKTOP_STEP = 140;
export const MOBILE_STEP = 110;
export const DESKTOP_AMP = 0.22;
export const MOBILE_AMP = 0.18;

const PAD_TOP = 168;
const PAD_BOTTOM = 200;

export interface NodePoint {
  date: string;
  index: number;
  x: number;
  y: number;
}

export function isCompactViewport(width: number, height: number): boolean {
  return width < 900 || height < 640;
}

/** 豆藤柱的中轴。只轻轻拧动，避免整条藤甩成宽 S。 */
export function columnCenterX(index: number, width: number, compact: boolean): number {
  const sway = width * (compact ? 0.04 : 0.045);
  return width / 2 + sway * Math.sin((index * Math.PI) / 4.2);
}

/** 柱体半径。日期节点贴在这个半径附近的藤面上。 */
export function columnRadius(width: number, compact: boolean): number {
  return width * (compact ? 0.27 : 0.24);
}

export function layoutDays(dates: string[], width: number, compact: boolean): NodePoint[] {
  const step = compact ? MOBILE_STEP : DESKTOP_STEP;
  const radius = columnRadius(width, compact);
  const count = dates.length;
  return dates.map((date, index) => ({
    date,
    index,
    x: columnCenterX(index, width, compact) + (index % 2 === 0 ? -1 : 1) * radius * 0.66,
    y: PAD_TOP + (count - 1 - index) * step,
  }));
}

export function contentHeight(count: number, compact: boolean): number {
  const step = compact ? MOBILE_STEP : DESKTOP_STEP;
  if (count <= 0) return PAD_TOP + PAD_BOTTOM;
  return PAD_TOP + (count - 1) * step + PAD_BOTTOM;
}

/** 三次贝塞尔，控制点放在纵向中点，只借用「平滑 S 形」这个思路。 */
export function vinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const mid = (previous.y + current.y) / 2;
    path += ` C ${previous.x.toFixed(1)} ${mid.toFixed(1)}, ${current.x.toFixed(1)} ${mid.toFixed(1)}, ${current.x.toFixed(1)} ${current.y.toFixed(1)}`;
  }
  return path;
}

export function wrapPoints(points: NodePoint[], width: number, compact: boolean): Array<{ x: number; y: number }> {
  const amp = width * (compact ? MOBILE_AMP : DESKTOP_AMP) * 0.72;
  const center = width / 2;
  return points.map((point) => ({
    x: center + amp * Math.sin((point.index * Math.PI) / 3.5 + Math.PI),
    y: point.y,
  }));
}

export function enumerateDates(start: string, end: string): string[] {
  if (!start || !end || start > end) return [];
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDaysISO(cursor, 1)) dates.push(cursor);
  return dates;
}

export function spanDays(response: JourneyResponse): JourneyDay[] {
  if (!response.plan) return response.days.map((day) => ({ ...day, loaded: true }));
  const known = new Map(response.days.map((day) => [day.date, day]));
  return enumerateDates(response.plan.startDate, response.plan.goalDate).map((date) => {
    const found = known.get(date);
    if (found) return { ...found, loaded: found.loaded !== false };
    const future = date > response.today;
    return {
      date,
      total: 0,
      done: 0,
      carried: 0,
      pending: 0,
      rate: null,
      stars: null,
      accuracy: null,
      starColor: null,
      hasCheckIn: false,
      minutes: 0,
      tags: [],
      state: future ? 'future' : 'empty',
      loaded: false,
    };
  });
}

export function primaryTag(tags: JourneyTag[]): JourneyTag | null {
  if (tags.includes('boss')) return 'boss';
  if (tags.includes('reinforce')) return 'reinforce';
  if (tags.includes('carried')) return 'carried';
  return null;
}

/** 旗标贴在节点外侧空白的一侧，偏移用 max-content，避免被藤叶挤成窄条。 */
export function flagAnchor(nodeX: number, viewW: number): { side: 'left' | 'right'; offset: string } {
  const side = nodeX > viewW / 2 ? 'left' : 'right';
  return { side, offset: 'calc(100% + 10px)' };
}

export function todayCta(day: JourneyDay | undefined): { title: string; subtitle: string } {
  if (!day || day.total <= 0 || day.state === 'empty') {
    return { title: '今天没有任务', subtitle: '去 Roadmap 看看安排' };
  }
  const label = day.date.slice(5);
  if (day.rate === 100) return { title: '今日已全清 ✓', subtitle: `${day.done}/${day.total}` };
  const left = tasksUntilFourStars(day.total, day.done);
  if (left <= 0) return { title: `闯 ${label}`, subtitle: `今日 ${day.done}/${day.total} · 已点亮 4★` };
  return { title: `闯 ${label}`, subtitle: `今日 ${day.done}/${day.total} · 再做 ${left} 项得 4★` };
}

export function remainingDays(goal: string, today: string): number {
  const start = new Date(`${today}T12:00:00`).getTime();
  const end = new Date(`${goal}T12:00:00`).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function scrollTopForToday(todayY: number, viewport: number, maxScroll: number): number {
  return Math.min(maxScroll, Math.max(0, todayY - viewport * 0.6));
}

/** 从藤根爬到今天。超过 10 节就不爬，直接落在今天。 */
export function climbSpan(todayIndex: number): { start: number; end: number } | null {
  if (todayIndex <= 0 || todayIndex > 10) return null;
  return { start: 0, end: todayIndex };
}

/** 今天落在哪一段。没有覆盖今天的阶段就没有云门。 */
export function currentPhase(phases: JourneyPhase[], today: string): JourneyPhase | null {
  return phases.find((phase) => phase.startDate <= today && today <= phase.endDate) ?? null;
}

/** 阶段末日已过去且当天任务全清，云门才打开。未到的阶段末保持关上。 */
export function phaseGateOpen(phase: JourneyPhase | null, days: JourneyDay[]): boolean {
  if (!phase) return true;
  const end = days.find((day) => day.date === phase.endDate);
  if (!end || end.state === 'future') return false;
  return end.rate === 100;
}

/** 最上一个槽位不能越过阶段末日，避免滚进下一段。 */
export function maxDayShiftBeforeGate(todayIndex: number, gateIndex: number, topDelta: number): number {
  return Math.max(0, gateIndex - todayIndex - topDelta);
}

/** 视口上下各多留一屏。 */
export function visibleIndices(ys: number[], scrollTop: number, viewport: number): number[] {
  const min = scrollTop - viewport;
  const max = scrollTop + viewport * 2;
  const indices: number[] = [];
  ys.forEach((y, index) => {
    if (y >= min && y <= max) indices.push(index);
  });
  return indices;
}
