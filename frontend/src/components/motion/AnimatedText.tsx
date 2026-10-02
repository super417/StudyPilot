import { useRef } from 'react';
import type { MotionValue } from 'framer-motion';
import { motion, useScroll, useTransform } from 'framer-motion';
import { CHAR_MAX_OPACITY, CHAR_MIN_OPACITY, charRange } from './utils';

export interface AnimatedTextProps {
  /** 需要逐字显现的文本 */
  text: string;
  /** 透传给外层容器的类名 */
  className?: string;
}

interface AnimatedCharProps {
  char: string;
  progress: MotionValue<number>;
  index: number;
  total: number;
}

/**
 * 单个动画字符 —— 独立组件各自调用 useTransform，避免在 map 循环里违反 hooks 规则。
 */
function AnimatedChar({ char, progress, index, total }: AnimatedCharProps) {
  const [start, end] = charRange(index, total);
  const opacity = useTransform(progress, [start, end], [CHAR_MIN_OPACITY, CHAR_MAX_OPACITY], {
    clamp: true,
  });
  // 保留空白字符的排版宽度。
  return (
    <motion.span style={{ opacity }}>{char === ' ' ? '\u00A0' : char}</motion.span>
  );
}

/**
 * AnimatedText — 滚动显字（需求 18.7、18.8）
 *
 * 随容器在视口中的滚动进度（offset ['start 0.8', 'end 0.2']）逐字从
 * 半透明显现到不透明；采用「不可见占位符 + 绝对定位动画层」，占位符撑开
 * 正常排版，动画层绝对定位覆盖其上，使排版位置在动画过程中保持不变（需求 18.8）。
 */
function AnimatedText({ text, className }: AnimatedTextProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.8', 'end 0.2'],
  });

  const chars = Array.from(text);

  return (
    <div ref={ref} className={className} style={{ position: 'relative' }}>
      {/* 不可见占位符：撑开正常文本排版，不参与动画。 */}
      <span aria-hidden style={{ opacity: 0 }}>
        {text}
      </span>
      {/* 绝对定位动画层：逐字显现，覆盖在占位符之上。 */}
      <span style={{ position: 'absolute', inset: 0 }}>
        {chars.map((char, index) => (
          <AnimatedChar
            key={index}
            char={char}
            index={index}
            total={chars.length}
            progress={scrollYProgress}
          />
        ))}
      </span>
    </div>
  );
}

export default AnimatedText;
