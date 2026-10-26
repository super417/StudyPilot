import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
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
  /** 仅为指定按钮启用弹性回弹，其他 Magnet 保持原有过渡 */
  elastic?: boolean;
  /** 文字层独立跟随指针的比例；0 表示不移动文字 */
  labelStrength?: number;
}

const ZERO_OFFSET: Offset = { x: 0, y: 0 };

/**
 * Magnet — 磁吸按钮（需求 18.4、18.5、18.6）
 *
 * 光标进入元素外扩 `padding` 范围时，内层元素朝光标方向位移 `(cursor − center) / strength`；
 * 进入过渡 0.3s ease-out（18.5），离开复位过渡 0.6s ease-in-out（18.6）。
 */
function Magnet({ children, strength = 3, padding = 150, className, elastic = false, labelStrength = 0 }: MagnetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<Offset>(ZERO_OFFSET);
  const [active, setActive] = useState(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 130, damping: 9, mass: 0.5 });
  const springY = useSpring(y, { stiffness: 130, damping: 9, mass: 0.5 });
  const labelX = useMotionValue(0);
  const labelY = useMotionValue(0);
  const springLabelX = useSpring(labelX, { stiffness: 130, damping: 9, mass: 0.5 });
  const springLabelY = useSpring(labelY, { stiffness: 130, damping: 9, mass: 0.5 });

  useEffect(() => {
    if (!labelStrength) return;
    const label = ref.current?.querySelector<HTMLElement>('[data-magnet-label]');
    if (!label) return;
    const updateLabel = () => {
      label.style.transform = `translate3d(${springLabelX.get()}px, ${springLabelY.get()}px, 0)`;
    };
    const stopX = springLabelX.on('change', updateLabel);
    const stopY = springLabelY.on('change', updateLabel);
    return () => {
      stopX();
      stopY();
      label.style.transform = '';
    };
  }, [labelStrength, springLabelX, springLabelY]);

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
        const nextOffset = computeMagnetOffset(cursor, center, strength);
        if (elastic) {
          x.set(nextOffset.x);
          y.set(nextOffset.y);
          const label = el.querySelector<HTMLElement>('[data-magnet-label]');
          const maxLabelY = label ? Math.max(0, (el.clientHeight - label.offsetHeight) / 2 - 2) : 0;
          labelX.set(Math.max(-24, Math.min(24, (cursor.x - center.x) * labelStrength)));
          labelY.set(Math.max(-maxLabelY, Math.min(maxLabelY, (cursor.y - center.y) * labelStrength)));
        } else {
          setOffset(nextOffset);
        }
      } else {
        setActive(false);
        if (elastic) {
          x.set(0);
          y.set(0);
          labelX.set(0);
          labelY.set(0);
        } else {
          setOffset(ZERO_OFFSET);
        }
      }
    }

    function handlePointerLeaveWindow() {
      setActive(false);
      if (elastic) {
        x.set(0);
        y.set(0);
        labelX.set(0);
        labelY.set(0);
      } else {
        setOffset(ZERO_OFFSET);
      }
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerleave', handlePointerLeaveWindow);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeaveWindow);
    };
  }, [strength, padding, elastic, labelStrength, x, y, labelX, labelY]);

  return (
    <div ref={ref} className={className}>
      {elastic ? (
        <motion.div style={{ x: springX, y: springY, willChange: 'transform' }}>
          {children}
        </motion.div>
      ) : (
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
      )}
    </div>
  );
}

export default Magnet;
