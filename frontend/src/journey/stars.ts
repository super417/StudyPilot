/**
 * 星藤航图的星数口径。必须和后端 `STAR_THRESHOLDS` 一致。
 * 颗数 = 完成率；颜色 = 正确率。未作答是 gray，不是 0 分。
 */

export const STAR_THRESHOLDS = [40, 60, 80] as const;

export const COLOR_THRESHOLDS = [40, 60, 80] as const;

export type StarColor = 'vivid' | 'warm' | 'cool' | 'muted' | 'gray';

export function computeStars(total: number, done: number): number | null {
  if (total <= 0) return null;
  const safeDone = Math.min(total, Math.max(0, done));
  if (safeDone * 100 >= STAR_THRESHOLDS[2] * total) return 4;
  if (safeDone * 100 >= STAR_THRESHOLDS[1] * total) return 3;
  if (safeDone * 100 >= STAR_THRESHOLDS[0] * total) return 2;
  return 1;
}

/** 向下取整，避免 39.5% 被四舍五入写成 40% 却仍是 1 星。 */
export function completionPercent(total: number, done: number): number | null {
  if (total <= 0) return null;
  const safeDone = Math.min(total, Math.max(0, done));
  return Math.floor((safeDone * 100) / total);
}

export function starColor(scoreSum: number, answered: number): StarColor {
  if (answered <= 0) return 'gray';
  if (scoreSum >= COLOR_THRESHOLDS[2] * answered) return 'vivid';
  if (scoreSum >= COLOR_THRESHOLDS[1] * answered) return 'warm';
  if (scoreSum >= COLOR_THRESHOLDS[0] * answered) return 'cool';
  return 'muted';
}

export function tasksUntilFourStars(total: number, done: number): number {
  if (total <= 0) return 0;
  const safeDone = Math.min(total, Math.max(0, done));
  const needed = Math.ceil((80 * total) / 100);
  return Math.max(0, needed - safeDone);
}
