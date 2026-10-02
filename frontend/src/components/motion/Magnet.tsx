import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Offset } from './utils';
import { computeMagnetOffset } from './utils';

export interface MagnetProps {
  /** 被磁吸吸引的子内容 */
  children: ReactNode;
  /** 位移分量除数，默认 3（值越大位移越小，需求 18.4） */
  strength?: number;
  /** 触发范围外扩像素，默认 150（需求 18.4） */
  padding?: number;
  /** 透传给外层容器的类名 */
  className?: string;
}

const ZERO_OFFSET: Offset = { x: 0, y: 0 };

/**
 * Magnet — 磁吸按钮（需求 18.4、18.5、18.6）
 *
 * 光标进入元素外扩 `padding` 范围时，内层元素朝光标方向位移 `(cursor − center) / strength`；
 * 进入过渡 0.3s ease-out（18.5），离开复位过渡 0.6s ease-in-out（18.6）。
 */
function Magnet({ children, strength = 3, padding = 150, className }: MagnetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<Offset>(ZERO_OFFSET);
  const [active, setActive] = useState(false);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const el = ref.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      const cursor = { x: event.clientX, y: event.clientY };

      // 判断光标是否进入元素外扩 padding 的矩形触发范围。
      const withinRange =
        cursor.x >= rect.left - padding &&
        cursor.x <= rect.right + padding &&
        cursor.y >= rect.top - padding &&
        cursor.y <= rect.bottom + padding;

      if (withinRange) {
        setActive(true);
        setOffset(computeMagnetOffset(cursor, center, strength));
      } else {
        setActive(false);
        setOffset(ZERO_OFFSET);
      }
    }

    function handlePointerLeaveWindow() {
      setActive(false);
      setOffset(ZERO_OFFSET);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerleave', handlePointerLeaveWindow);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeaveWindow);
    };
  }, [strength, padding]);

  return (
    <div ref={ref} className={className}>
      <div
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
          transition: active
            ? 'transform 0.3s ease-out'
            : 'transform 0.6s ease-in-out',
          willChange: 'transform',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default Magnet;
