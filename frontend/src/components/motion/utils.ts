/**
 * Motion 工具 —— 与组件解耦的常量与纯函数（需求 18）。
 *
 * 这些非组件导出集中于此，避免污染组件文件的 Fast Refresh 边界
 * （react-refresh/only-export-components）。
 */

/** FadeIn 默认缓动曲线（需求 18.2）。 */
export const FADE_IN_EASE: [number, number, number, number] = [0.25, 0.1, 0.25, 1];

/** FadeIn 默认参数（需求 18.2 / Property 25）。 */
export const FADE_IN_DEFAULTS = {
  delay: 0,
  duration: 0.7,
  x: 0,
  y: 0,
} as const;

/** AnimatedText 字符不透明度上下限（需求 18.7 / Property 26）。 */
export const CHAR_MIN_OPACITY = 0.2;
export const CHAR_MAX_OPACITY = 1;

/**
 * 某字符在整体进度下的显现区间（Property 26）。
 * 第 index 个字符占 `[index/total, (index+1)/total]`。
 */
export function charRange(index: number, total: number): [number, number] {
  if (total <= 0) return [0, 1];
  return [index / total, (index + 1) / total];
}

/**
 * 线性插值字符不透明度：区间内从 MIN 单调不减到 MAX（Property 26）。
 */
export function computeCharOpacity(progress: number, index: number, total: number): number {
  const [start, end] = charRange(index, total);
  if (progress <= start) return CHAR_MIN_OPACITY;
  if (progress >= end) return CHAR_MAX_OPACITY;
  const t = (progress - start) / (end - start);
  return CHAR_MIN_OPACITY + t * (CHAR_MAX_OPACITY - CHAR_MIN_OPACITY);
}

/** 二维偏移向量。 */
export interface Offset {
  x: number;
  y: number;
}

/**
 * 计算磁吸位移（纯函数，便于测试，需求 18.4 / Property 23）。
 *
 * 位移恒等于 `(cursor − center) / strength`；光标位于中心时位移为 (0, 0)。
 */
export function computeMagnetOffset(
  cursor: Offset,
  center: Offset,
  strength: number,
): Offset {
  return {
    x: (cursor.x - center.x) / strength,
    y: (cursor.y - center.y) / strength,
  };
}

/** 相邻卡片间的缩放步进（需求 18.9 / Property 24）。 */
export const SCALE_STEP = 0.03;

/**
 * 计算第 `index` 张卡片的目标缩放（纯函数，便于测试，需求 18.9 / Property 24）。
 *
 * `targetScale = 1 − (totalCards − 1 − index) × 0.03`；
 * 最后一张（index = totalCards − 1）恒为 1.0。
 */
export function computeTargetScale(index: number, totalCards: number): number {
  return 1 - (totalCards - 1 - index) * SCALE_STEP;
}
