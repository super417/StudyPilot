import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

export interface CardShellProps {
  /** 卡片标题 */
  title: string;
  /** 标题左侧图标 */
  icon?: ReactNode;
  /** 右上角操作区（按钮等） */
  action?: ReactNode;
  /** 卡片主体 */
  children: ReactNode;
  /** 额外类名（用于跨列、突出等） */
  className?: string;
  /** 是否启用 hover 抬升（默认启用） */
  hoverable?: boolean;
}

/**
 * 个人中心统一卡片外壳：白底大圆角轻阴影（复用 .card），标题行 + 主体。
 * hover 时轻微抬升并加深阴影，提供一致的交互反馈。
 */
function CardShell({
  title,
  icon,
  action,
  children,
  className = '',
  hoverable = true,
}: CardShellProps) {
  return (
    <motion.section
      whileHover={hoverable ? { y: -4 } : undefined}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className={`card flex flex-col p-6 transition-shadow hover:shadow-[0_16px_48px_rgba(6,78,59,0.12)] ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {icon ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brandFaint text-brandDark">
              {icon}
            </span>
          ) : null}
          <h3 className="text-base font-bold text-brandDark">{title}</h3>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-4 flex-1">{children}</div>
    </motion.section>
  );
}

export default CardShell;
