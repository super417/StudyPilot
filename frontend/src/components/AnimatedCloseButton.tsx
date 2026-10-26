import { useState } from 'react';
import { Minus, X } from 'lucide';
import { MorphIcon } from 'morphicons/react';

interface AnimatedCloseButtonProps {
  /** 点击后调用：父级负责收起被关闭的内容。 */
  onClose: () => void;
  label: string;
  className?: string;
}

/**
 * 带「组成」动效的关闭按钮：静止时是一条短横线，鼠标悬停（或键盘聚焦）时
 * morph 成 ×，移开后收回横线。
 *
 * 走 MorphIcon 的**非受控模式**（`icon` 换值即补间），与主人给的写法一致：
 *   <MorphIcon icon={hovered ? X : Minus} />
 * 而不是挂载/点击时用 ref 手动 morphTo —— 那样动效发生在进入页面和点击瞬间，
 * 不是"悬停才动"。
 */
function AnimatedCloseButton({ onClose, label, className = '' }: AnimatedCloseButtonProps) {
  const [armed, setArmed] = useState(false);

  return (
    <button
      type="button"
      onClick={onClose}
      onMouseEnter={() => setArmed(true)}
      onMouseLeave={() => setArmed(false)}
      onFocus={() => setArmed(true)}
      onBlur={() => setArmed(false)}
      aria-label={label}
      title={label}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${className}`}
    >
      <MorphIcon icon={armed ? X : Minus} size={14} strokeWidth={2.25} spring="snappy" reducedMotion="never" />
    </button>
  );
}

export default AnimatedCloseButton;
