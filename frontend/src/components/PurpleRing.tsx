import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useInView } from 'framer-motion';

/**
 * PurpleRing — 本周复盘知识掌握平均值紫色环形图（需求 7.2 / 12.8 / 18.20）
 *
 * 浅紫轨道（#EDE9FE）+ 紫色（#8B5CF6）进度弧。配色、尺寸、圆心「知识掌握」
 * 小字均保持不变。
 *
 * 动效（需求 18.20）：进入视口时用 SVG pathLength 从 0 绘制到实际进度值。
 * - 进度弧为 motion.circle，initial={{ pathLength: 0 }}、
 *   whileInView={{ pathLength: value/100 }}，viewport.once（只播一次），
 *   duration 1.2 平滑缓动。pathLength 为 0~1，可见弧比例 = value/100；
 *   framer-motion 会自动处理 pathLength 对应的 dasharray，弧仍从 12 点方向
 *   顺时针（保留现有 rotate(-90)）。
 * - 圆心百分比数字随环形同步从 0 弹到 value：useMotionValue + useSpring 驱动，
 *   在容器进入视口时启动，最终停在 clamp 后的 masteryAvg 值。
 * 所有 hooks 均在组件顶层调用，符合 hooks 规则。
 */

export interface PurpleRingProps {
  /** 知识掌握平均值百分比 0-100 */
  percent: number;
  /** 环形直径（像素），默认 176 */
  size?: number;
}

function PurpleRing({ percent, size = 176 }: PurpleRingProps) {
  // 约束到 0-100，避免异常 mock 值撑破弧长
  const value = Math.max(0, Math.min(100, percent));
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;

  // 圆心数字随环形绘制递增：spring 平滑逼近目标值。
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '50px' });
  const count = useMotionValue(0);
  const spring = useSpring(count, { duration: 1200, bounce: 0 });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (inView) count.set(value);
  }, [inView, value, count]);

  useEffect(() => {
    const unsubscribe = spring.on('change', (latest) => {
      setDisplay(Math.round(latest));
    });
    return unsubscribe;
  }, [spring]);

  return (
    <div ref={ref} className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`知识掌握平均值 ${value}%`}>
        {/* 轨道：极浅紫 */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#EDE9FE"
          strokeWidth={strokeWidth}
        />
        {/* 进度弧：紫色主色，进入视口时 pathLength 从 0 绘制到 value/100，从 12 点方向顺时针 */}
        <motion.circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#8B5CF6"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: value / 100 }}
          viewport={{ once: true, margin: '50px' }}
          transition={{ duration: 1.2, ease: [0.25, 0.1, 0.25, 1] }}
        />
      </svg>
      {/* 圆心文字：数字随绘制递增，最终停在 value */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-4xl font-bold leading-none text-purple">
          {display}%
        </span>
        <span className="mt-1 text-xs font-medium text-gray-400">知识掌握</span>
      </div>
    </div>
  );
}

export default PurpleRing;
