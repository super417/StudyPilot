import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

export interface InteractiveCardProps {
  /** 被包裹的展示卡内容 */
  children: ReactNode;
  /** 透传给动画元素的类名（允许传入 .card 等样式类） */
  className?: string;
}

/**
 * InteractiveCard — 可复用「可交互展示卡」动效包裹组件
 *
 * 只负责 hover / tap 的克制而高级的交互，不带任何入场动效——
 * 入场交给外层 FadeIn。这样内外分层，各自只用自己的 transform，
 * 避免 FadeIn 的 opacity/x/y 入场与本组件的 y/scale 交互相互打架。
 *
 * 交互参数：
 * - whileHover：轻微上浮 + 放大 + 绿色调阴影加深（y:-4, scale:1.015）。
 * - whileTap：轻微回弹按下（scale:0.985）。
 * - transition：平滑弹簧（spring, stiffness 300, damping 24）。
 * - willChange:'transform' 提示浏览器提前优化合成层。
 */
function InteractiveCard({ children, className }: InteractiveCardProps) {
  return (
    <motion.div
      className={className}
      style={{ willChange: 'transform' }}
      whileHover={{
        y: -4,
        scale: 1.015,
        boxShadow: '0 18px 44px -12px rgba(6,78,59,0.22)',
      }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
    >
      {children}
    </motion.div>
  );
}

export default InteractiveCard;
