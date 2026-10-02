/**
 * 备考时间流逝进度的纯计算逻辑（需求 4.1）
 *
 * 与 UI 解耦，便于后续属性测试（Property 19：环形进度落在 0-100 且随时间单调）。
 */

/** 一天的毫秒数，用于将日期差换算成天数 */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 计算「备考时间流逝百分比」。
 *
 * 口径：ring =（today − startDate）/（goalDate − startDate）× 100，clamp 0–100。
 * - today ≤ startDate → 0
 * - today ≥ goalDate → 100
 * - startDate ≥ goalDate（非法/零跨度）→ 0，避免除零
 */
export function computeElapsedPercent(
  startDate: string | Date,
  goalDate: string | Date,
  today: string | Date,
): number {
  const start = new Date(startDate).getTime();
  const goal = new Date(goalDate).getTime();
  const now = new Date(today).getTime();

  const span = goal - start;
  if (!Number.isFinite(span) || span <= 0) {
    return 0;
  }

  const elapsed = ((now - start) / span) * 100;
  return Math.min(100, Math.max(0, elapsed));
}

/** 计算从 startDate 到 today 的自然日「第 N 天」（至少为 1） */
export function computeDayNumber(startDate: string | Date, today: string | Date): number {
  const start = new Date(startDate).getTime();
  const now = new Date(today).getTime();
  const days = Math.floor((now - start) / MS_PER_DAY) + 1;
  return days < 1 ? 1 : days;
}
