import { LogOut } from 'lucide-react';
import { openMainframePage } from '@/lib/mainframeRoute';

export interface HeaderProps {
  /** 右上状态文案，如 "本地学习中" */
  statusText?: string;
  /** 右上角学习者标识文案，如 "学习者" */
  userLabel?: string;
  /** 可选的退出登录操作 */
  onLogout?: () => void;
}

/**
 * 顶部页头
 * - 左上：StudyPilot 品牌（点击进入演示首屏）
 * - 右上：状态 + 退出
 */
function Header({
  statusText = '本地学习中',
  userLabel = '学习者',
  onLogout,
}: HeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <button
        type="button"
        onClick={openMainframePage}
        className="flex min-w-0 items-center gap-2.5 text-left transition hover:opacity-80"
        aria-label="打开 StudyPilot 演示首屏"
        title="打开 StudyPilot 演示首屏"
      >
        <span
          className="truncate text-xl font-bold tracking-tight text-brandDark sm:text-2xl"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          StudyPilot
        </span>
        <span
          className="select-none text-2xl text-brandDark sm:text-[28px]"
          style={{ letterSpacing: '-0.02em' }}
          aria-hidden="true"
        >
          ✳︎
        </span>
      </button>

      <div className="flex flex-wrap items-center justify-end gap-3 text-sm text-gray-500">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
          <span>{statusText}</span>
          <span className="ml-2 font-medium text-brandDark">{userLabel}</span>
        </div>
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-1.5 rounded-full border border-brandFaint bg-white/70 px-3 py-1.5 font-medium text-brandDark backdrop-blur-md transition hover:border-brand hover:text-brand"
            aria-label="退出登录"
          >
            <LogOut size={15} aria-hidden="true" />
            <span>退出登录</span>
          </button>
        )}
      </div>
    </header>
  );
}

export default Header;
