import type { ReactNode } from 'react';
import { Children } from 'react';
import { computeTargetScale } from './utils';

export interface StickyStackProps {
  /** 需要粘性堆叠的卡片子项列表 */
  children: ReactNode[];
  /** 透传给外层容器的类名 */
  className?: string;
}

/** 相邻卡片间的堆叠错位（px）。 */
const TOP_STEP = 28;
/** sticky 基准顶距（px）。 */
const STICKY_BASE_TOP = 24;

/**
 * StickyStack — 粘性堆叠（需求 18.9）
 *
 * 每张卡片 `position: sticky; top: 24px + index × 28px`，并按
 * `computeTargetScale` 逐层缩放，滚动时形成卡片堆叠错位的视觉效果。
 */
function StickyStack({ children, className }: StickyStackProps) {
  const items = Children.toArray(children);
  const totalCards = items.length;

  return (
    <div className={className}>
      {items.map((child, index) => (
        <div
          key={index}
          style={{
            position: 'sticky',
            top: STICKY_BASE_TOP + index * TOP_STEP,
            transform: `scale(${computeTargetScale(index, totalCards)})`,
            transformOrigin: 'top center',
            willChange: 'transform',
          }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

export default StickyStack;
