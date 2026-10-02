/**
 * 悬浮图标位置的边界钳制纯函数（需求 8.3 / 8.4 / 8.5，对应设计 Property 10）
 *
 * 与 UI 解耦：视口 resize 时可用它把图标重新钳制进可视区域，
 * 保证图标完整可见且落在最近的合法点上。便于后续属性测试。
 */

/** 二维尺寸（宽高，单位 px） */
export interface Size {
  width: number;
  height: number;
}

/** 悬浮图标坐标（左上角，单位 px） */
export interface IconPosition {
  x: number;
  y: number;
}

/**
 * 把坐标钳制进视口，使图标完整位于视口内。
 *
 * 口径：
 * - x = clamp(pos.x, 0, viewport.width  − iconSize.width)
 * - y = clamp(pos.y, 0, viewport.height − iconSize.height)
 *
 * 边界情况：当视口比图标还小时，上界 `max` 会变成负数，
 * 此时取 `max(lower, 0)` 保证结果不小于 0（图标贴左/上边）。
 */
export function clampIconPosition(
  pos: IconPosition,
  viewport: Size,
  iconSize: Size,
): IconPosition {
  const maxX = Math.max(0, viewport.width - iconSize.width);
  const maxY = Math.max(0, viewport.height - iconSize.height);

  return {
    x: Math.min(Math.max(pos.x, 0), maxX),
    y: Math.min(Math.max(pos.y, 0), maxY),
  };
}
