import { LayoutDashboard, Map, BookX, CalendarRange, Sparkles } from 'lucide-react';
import type { TabKey } from '@/components/TabNav';
import { useAsync } from './useAsync';
import { fetchStudyProgress } from '@/lib/profileStudyApi';
import { usePlanSessionStore } from '@/store/planSessionStore';

export interface LeftRailProps {
  /** 展示昵称（来自 profilePrefs） */
  displayName: string;
  /** 登录用户标识（authStore.userId） */
  userId: string | null;
  /** 打开「编辑资料」弹窗 */
  onEditProfile: () => void;
  /** 切换到指定 Tab */
  onNavigate: (tab: TabKey) => void;
}

/** 快捷入口配置（切到其它已完成页面）。 */
const QUICK_LINKS: { tab: TabKey; label: string; icon: typeof Map }[] = [
  { tab: 'overview', label: '总览', icon: LayoutDashboard },
  { tab: 'roadmap', label: 'Roadmap', icon: Map },
  { tab: 'mistakes', label: '错题本', icon: BookX },
  { tab: 'weekly', label: '本周复盘', icon: CalendarRange },
];

/**
 * 左栏：问候 + 学习效率大数字概览 + 快捷入口。
 *
 * 排布对齐参考图左栏：**问候块与效率块不套卡片**，头像徽标、大字标题、巨型数字
 * 直接压在雪山背景上；快捷入口用液态玻璃（浅绿着色）收尾 —— 承担参考图左栏那张
 * 强调色卡的角色，但材质与右栏面板统一为毛玻璃。
 *
 * 两处必要的防御：
 *   - 文字挂 .text-on-photo（极淡白色光晕）：背景纵向从浅色天空过渡到深色草地，
 *     视口高度不同文字可能压到草地上，光晕保证任何高度都能读清；
 *   - 两个漂浮块加 px-1：外层 aside 是滚动容器（overflow 会把 overflow-x 也变成
 *     auto），贴边的头像阴影会被裁掉，留 4px 余量。
 */
function LeftRail({ displayName, userId, onEditProfile, onNavigate }: LeftRailProps) {
  const lastPlanId = usePlanSessionStore((s) => s.lastPlanId);
  const { data } = useAsync(fetchStudyProgress, lastPlanId);
  const overall = data?.overallPercent ?? null;

  return (
    <div className="flex min-h-full flex-col gap-6">
      {/* 问候块：不套卡片 */}
      <section className="px-1">
        <div className="flex items-center gap-3.5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] bg-gradient-to-br from-brand to-brandDark text-3xl font-bold text-white shadow-[0_10px_28px_rgba(16,185,129,0.4)] ring-2 ring-white/80">
            {displayName.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <p className="text-on-photo truncate text-xl font-bold leading-tight text-brandDark">
              你好，{displayName} 👋
            </p>
            <p className="text-on-photo mt-1 truncate text-xs font-medium text-brandDark/80">
              {userId ?? '本地学习中'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onEditProfile}
          className="mt-4 inline-flex items-center rounded-full border border-white/70 bg-white/70 px-4 py-2 text-sm font-medium text-brandDark shadow-[0_4px_16px_rgba(6,78,59,0.10)] backdrop-blur transition hover:bg-white/90"
        >
          编辑资料
        </button>
      </section>

      {/* 效率块：不套卡片，巨型数字直接压在背景上 */}
      <section className="px-1">
        <div className="flex items-baseline gap-1">
          <span className="text-on-photo font-display text-7xl font-bold leading-none text-brandDark">
            {overall ?? '—'}
          </span>
          <span className="text-on-photo text-3xl font-bold text-brand">%</span>
        </div>
        <p className="text-on-photo mt-3 text-sm font-medium text-brandDark">当前学习效率</p>
        <p className="text-on-photo mt-0.5 text-xs font-medium text-brandDark/80">
          总体进度概览，助你把握备考节奏
        </p>
        <div className="mt-3.5 h-2 overflow-hidden rounded-full bg-white/55 ring-1 ring-white/60">
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${overall ?? 0}%` }}
          />
        </div>
      </section>

      {/*
        快捷入口块：液态玻璃（浅绿着色变体）。
        承担参考图左栏那张"强调色卡"的角色，但材质与右栏面板统一为毛玻璃 ——
        透出背后雪山，同时靠 .liquid-glass--tint 的浅绿保住强调色身份。
        圆角用 rounded-[28px] 覆盖 .liquid-glass 默认的 32px：左栏比右栏窄，
        28px 的比例更合适（utilities 层在 components 之后，能覆盖）。
      */}
      <section className="liquid-glass liquid-glass--tint rounded-[28px] p-5">
        <p className="mb-3 flex items-center gap-1.5 text-sm font-bold text-brandDark">
          <Sparkles size={15} aria-hidden="true" />
          快捷入口
        </p>
        <div className="grid grid-cols-2 gap-2">
          {QUICK_LINKS.map(({ tab, label, icon: Icon }) => (
            <button
              key={tab}
              type="button"
              onClick={() => onNavigate(tab)}
              className="flex items-center gap-2 rounded-2xl bg-white/70 px-3 py-2.5 text-sm font-medium text-brandDark shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition hover:bg-white/90"
            >
              <Icon size={15} aria-hidden="true" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export default LeftRail;
