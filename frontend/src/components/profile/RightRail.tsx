import { CheckCircle2, Circle, ListTodo, Zap, Activity, Bot } from 'lucide-react';
import { useAssistantStore } from '@/store/assistantStore';
import type { TabKey } from '@/components/TabNav';
import { CardEmpty, CardError, CardLoading } from './states';
import { useAsync } from './useAsync';
import { fetchRecentActivities, fetchTodayTodos } from '@/lib/profileStudyApi';

export interface RightRailProps {
  /** 占位 / 操作反馈 */
  onAction: (message: string) => void;
  /** 切到指定 Tab（快捷操作） */
  onNavigate?: (tab: TabKey) => void;
}

/**
 * 玻璃面板内的分区：标题行 + 主体，分区之间只用一条细分隔线。
 */
function GlassSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="liquid-glass-section">
      <p className="mb-3 flex items-center gap-1.5 text-sm font-bold text-brandDark">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/70 text-brandDark shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
          {icon}
        </span>
        {title}
      </p>
      {children}
    </section>
  );
}

/** 今日待办：真实 daily-tasks。 */
function TodayTodo() {
  const { data, loading, error } = useAsync(fetchTodayTodos);
  return (
    <GlassSection title="今日待办" icon={<ListTodo size={14} aria-hidden="true" />}>
      {loading ? (
        <CardLoading rows={3} />
      ) : error ? (
        <CardError message={error} />
      ) : !(data && data.length) ? (
        <CardEmpty>今日暂无任务。生成规划后会出现在这里。</CardEmpty>
      ) : (
        <ul className="space-y-2.5">
          {data.map((todo) => (
            <li key={todo.id} className="flex items-start gap-2 text-sm">
              {todo.done ? (
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
              ) : (
                <Circle size={16} className="mt-0.5 shrink-0 text-gray-300" aria-hidden="true" />
              )}
              <span className="min-w-0">
                <span
                  className={`block ${todo.done ? 'text-gray-400 line-through' : 'text-brandDark'}`}
                >
                  {todo.title}
                </span>
                <span className="text-xs text-gray-400">{todo.tag}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </GlassSection>
  );
}

/** 快捷操作：跳转真实页面或唤起助手。 */
function QuickActions({
  onAction,
  onNavigate,
}: {
  onAction: (message: string) => void;
  onNavigate?: (tab: TabKey) => void;
}) {
  const openAssistant = useAssistantStore((s) => s.openAssistant);
  const openAssistantWithContext = useAssistantStore((s) => s.openAssistantWithContext);

  const actions: Array<{ label: string; run: () => void }> = [
    {
      label: '开始专注学习',
      run: () => {
        onNavigate?.('overview');
        onAction('已打开总览，可打卡开始今日学习');
      },
    },
    {
      label: '记录一道错题',
      run: () => {
        onNavigate?.('mistakes');
        window.location.hash = 'new-mistake';
        window.dispatchEvent(new Event('studypilot:open-mistake-form'));
        onAction('已打开错题录入');
      },
    },
    {
      label: '和助手聊两句',
      run: () => {
        openAssistant();
        onAction('已唤起学习助手');
      },
    },
    {
      label: '生成本周复盘',
      run: () => {
        onNavigate?.('weekly');
        onAction('已打开本周复盘（有打卡记录时会惰性生成）');
      },
    },
  ];

  return (
    <GlassSection title="快捷操作" icon={<Zap size={14} aria-hidden="true" />}>
      <div className="grid grid-cols-2 gap-2">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.run}
            className="liquid-glass-tile px-3 py-2.5 text-left text-sm font-medium text-brandDark"
          >
            {a.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          openAssistantWithContext({ type: 'plan', hint: '制定或调整考研复习规划' });
          onAction('已打开规划目标表单');
        }}
        className="liquid-glass-tile mt-2 w-full px-3 py-2 text-left text-xs font-medium text-brandDark/80"
      >
        提交 / 调整考研规划
      </button>
    </GlassSection>
  );
}

/** 最近动态：由真实学习数据派生。 */
function RecentActivity() {
  const { data, loading, error } = useAsync(fetchRecentActivities);
  return (
    <GlassSection title="最近动态" icon={<Activity size={14} aria-hidden="true" />}>
      {loading ? (
        <CardLoading rows={4} />
      ) : error ? (
        <CardError message={error} />
      ) : !(data && data.length) ? (
        <CardEmpty>暂无动态。上传资料、生成规划或打卡后会出现在这里。</CardEmpty>
      ) : (
        <ul className="space-y-3">
          {data.map((item) => (
            <li key={item.id} className="flex gap-2.5 text-sm">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className="block text-brandDark">{item.text}</span>
                <span className="text-xs text-gray-400">{item.at}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </GlassSection>
  );
}

function AiShortcut() {
  const openAssistant = useAssistantStore((s) => s.openAssistant);
  return (
    <section className="liquid-glass-section">
      <div className="rounded-[24px] bg-gradient-to-br from-brandDark to-brand p-5 text-white shadow-[0_10px_30px_rgba(6,78,59,0.28)]">
        <p className="flex items-center gap-1.5 text-sm font-bold">
          <Bot size={16} aria-hidden="true" />
          AI 学习助手
        </p>
        <p className="mt-2 text-xs leading-relaxed text-white/85">
          遇到难题、需要讲解或规划？随时唤起助手，带上下文继续对话。
        </p>
        <button
          type="button"
          onClick={openAssistant}
          className="mt-4 w-full rounded-full bg-white/95 px-3.5 py-2 text-sm font-semibold text-brandDark transition hover:bg-white"
        >
          唤起 AI 助手
        </button>
      </div>
    </section>
  );
}

function RightRail({ onAction, onNavigate }: RightRailProps) {
  return (
    <div className="liquid-glass min-h-full p-5">
      <TodayTodo />
      <QuickActions onAction={onAction} onNavigate={onNavigate} />
      <RecentActivity />
      <AiShortcut />
    </div>
  );
}

export default RightRail;
