import { openMainframePage } from '@/lib/mainframeRoute';

/** Tab 的 key 联合类型，保证类型安全（需求 12.5） */
export type TabKey = 'overview' | 'roadmap' | 'mistakes' | 'weekly' | 'profile';

/** 单个 Tab 的展示配置 */
interface TabItem {
  key: TabKey;
  label: string;
}

/** 五个内容 Tab，顺序对应参考 UI */
const TABS: readonly TabItem[] = [
  { key: 'overview', label: '总览' },
  { key: 'roadmap', label: 'Roadmap' },
  { key: 'mistakes', label: '错题本' },
  { key: 'weekly', label: '本周复盘' },
  { key: 'profile', label: '个人中心' },
];

export interface TabNavProps {
  /** 当前激活的 Tab（受控） */
  activeTab: TabKey;
  /** Tab 切换回调 */
  onChange: (tab: TabKey) => void;
}

/**
 * 顶部居中 Tab 导航
 * - 最左侧 StudyPilot：进入演示首屏（图二）
 * - 其余为内容板块；外层毛玻璃胶囊
 */
function TabNav({ activeTab, onChange }: TabNavProps) {
  return (
    <nav className="flex justify-center overflow-x-auto">
      <div className="flex w-max items-center gap-1 rounded-full border border-white/50 bg-white/45 p-1 shadow-[0_8px_28px_rgba(6,78,59,0.08)] backdrop-blur-xl">
        <button
          type="button"
          onClick={openMainframePage}
          aria-label="打开 StudyPilot 演示首屏"
          title="打开 StudyPilot 演示首屏"
          className="whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold tracking-tight text-brandDark transition-colors hover:bg-white/55 sm:px-4"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          StudyPilot
        </button>
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onChange(tab.key)}
              className={`whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium transition-colors sm:px-4 ${
                isActive
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-brandDark/70 hover:bg-white/55 hover:text-brandDark'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default TabNav;
