import { motion, useScroll, useSpring } from 'framer-motion';

export interface ScrollProgressBarProps {
  /** 透传给进度条的类名 */
  className?: string;
}

/**
 * ScrollProgressBar — 顶部滚动进度条（需求 18.26）
 *
 * 基于页面滚动进度 `scrollYProgress` 经 `useSpring` 平滑后驱动细进度条的
 * `scaleX`（`transformOrigin: 'left'`），固定在页面顶部，薄荷绿主色。
 */
function ScrollProgressBar({ className }: ScrollProgressBarProps) {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 20,
    restDelta: 0.001,
  });

  return (
    <motion.div
      className={`fixed left-0 right-0 top-0 z-50 h-1 origin-left bg-brand ${className ?? ''}`}
      style={{ scaleX }}
    />
  );
}

export default ScrollProgressBar;
