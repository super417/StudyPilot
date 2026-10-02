import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { FADE_IN_DEFAULTS, FADE_IN_EASE } from './utils';

export interface FadeInProps {
  /** 被包裹的子内容 */
  children: ReactNode;
  /** 入场延迟（秒），默认 0 */
  delay?: number;
  /** 入场时长（秒），默认 0.7（需求 18.2） */
  duration?: number;
  /** 水平入场位移（px），默认 0 */
  x?: number;
  /** 垂直入场位移（px），默认 0 */
  y?: number;
  /** 透传给动画元素的类名 */
  className?: string;
}

/** 通过 motion.create() 动态生成的动画元素（设计要求，需求 18.1）。 */
const MotionDiv = motion.create('div');

/**
 * FadeIn — 通用入场动效（需求 18.1、18.2、18.3）
 *
 * 元素首次进入视口时从 `opacity:0` + 指定位移淡入到位；
 * `viewport.once = true` 保证只播一次，后续可见性变化不重播（需求 18.3）。
 */
function FadeIn({
  children,
  delay = FADE_IN_DEFAULTS.delay,
  duration = FADE_IN_DEFAULTS.duration,
  x = FADE_IN_DEFAULTS.x,
  y = FADE_IN_DEFAULTS.y,
  className,
}: FadeInProps) {
  return (
    <MotionDiv
      className={className}
      initial={{ opacity: 0, x, y }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: '50px', amount: 0 }}
      transition={{ delay, duration, ease: FADE_IN_EASE }}
    >
      {children}
    </MotionDiv>
  );
}

export default FadeIn;
