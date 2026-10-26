import { useState } from 'react';
import type { DailyTask, TodayStatus } from '@/mocks/types';
import CheckInForm from '@/components/CheckInForm';
import type { CheckInFormValues } from '@/components/CheckInForm';
import { Magnet } from '@/components/motion';
import './TodayTaskCard.css';

/** 时长快捷选项（分钟，需求 4.5） */
const DURATION_OPTIONS = [60, 75, 90] as const;

export interface TodayTaskCardProps {
  /** 今日任务状态徽标（未反馈 / 已安排 / 已完成，来自 metrics.todayStatus） */
  todayStatus: TodayStatus;
  /** 今日日期展示文案，默认占位「今天」 */
  date?: string;
  /** 「开始今天的学习」：打开助手并带上所选时长 */
  onStart?: (durationMinutes: number) => void;
  /** 完成打卡回调（可选），透传给内部 CheckInForm */
  onCheckIn?: (values: CheckInFormValues) => void;
  /** 当日任务；点条目在 pending / done 之间切换 */
  tasks?: DailyTask[];
  onToggleTask?: (task: DailyTask) => void;
  /** 首屏加载完成后再提示「今天还没有安排任务」 */
  tasksReady?: boolean;
  /** 已有规划但今天没有任务时，空态不要再催用户去生成。 */
  hasPlan?: boolean;
  onAddToday?: () => void;
  addingToday?: boolean;
}

/** 状态徽标配色（绿卡上用半透明白底，保持纯白文字风格） */
const STATUS_BADGE = 'bg-white/20 text-white';

/**
 * TodayTaskCard — 总览页右侧任务卡片（需求 4.4 / 4.5 / 12.6）
 *
 * 绿色渐变背景 + 纯白文字的大圆角卡片：展示今日日期、今日任务状态徽标、
 * 60/75/90 分钟时长快捷选项（本地 state 记录选中，选中态白底绿字），
 * 「开始今天的学习」主按钮（绿色渐变胶囊），
 * 下半部内嵌 CheckInForm 打卡表单（需求 4.6）。
 *
 * 动效（任务 26 · 需求 18.4）：「开始今天的学习」按钮用弹性 Magnet 包裹
 * （strength = 2.5、padding = 150），光标接近时按钮和文字分别磁吸并弹性回位。
 */
function TodayTaskCard({
  todayStatus,
  date = '今天',
  onStart,
  onCheckIn,
  tasks = [],
  onToggleTask,
  tasksReady = false,
  hasPlan = false,
  onAddToday,
  addingToday = false,
}: TodayTaskCardProps) {
  const [selectedDuration, setSelectedDuration] = useState<number>(DURATION_OPTIONS[0]);

  const handleStart = () => {
    onStart?.(selectedDuration);
  };

  return (
    <section className="rounded-[32px] bg-gradient-to-br from-brand to-brandDark p-6 text-white shadow-[0_10px_40px_rgba(6,78,59,0.18)] sm:p-8">
      {/* 头部：日期 + 状态徽标 */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-widest text-white/70">
            TODAY
          </p>
          <p className="mt-1 font-display text-2xl font-bold leading-none">{date}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE}`}
        >
          {todayStatus}
        </span>
      </div>

      {/* 时长快捷选项（需求 4.5） */}
      <div className="mt-6">
        <p className="text-xs font-medium text-white/70">今日学习时长</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {DURATION_OPTIONS.map((minutes) => {
            const selected = minutes === selectedDuration;
            return (
              <button
                key={minutes}
                type="button"
                aria-pressed={selected}
                onClick={() => setSelectedDuration(minutes)}
                className={
                  selected
                    ? 'rounded-2xl bg-white py-3 text-center font-display text-lg font-bold text-brandDark'
                    : 'rounded-2xl bg-white/15 py-3 text-center font-display text-lg font-bold text-white/90 hover:bg-white/25'
                }
              >
                {minutes}
                <span className="ml-0.5 text-xs font-medium">分钟</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 开始今天的学习（需求 4.4），弹性 Magnet 磁吸包裹（需求 18.4） */}
      <Magnet strength={2.5} padding={150} elastic labelStrength={0.24} className="mt-5">
        <button
          type="button"
          onClick={handleStart}
          className="today-start-button"
        >
          <span className="today-start-button-bg" aria-hidden="true" />
          <span className="today-start-button-label" data-magnet-label>开始今天的学习</span>
        </button>
      </Magnet>

      {tasks.length > 0 ? (
        <ul className="mt-5 space-y-2">
          {tasks.map((task) => {
            const done = task.status === 'done';
            return (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => onToggleTask?.(task)}
                  aria-pressed={done}
                  className="flex w-full items-start gap-2 rounded-2xl bg-white/15 px-3 py-2 text-left text-sm leading-snug hover:bg-white/25"
                >
                  <span className="mt-0.5 shrink-0" aria-hidden="true">
                    {done ? '✓' : '○'}
                  </span>
                  <span className={done ? 'line-through opacity-70' : ''}>{task.description}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : tasksReady ? (
        <div className="mt-4">
          <p className="text-xs text-white/70">
            {hasPlan
              ? '这份规划今天没有排任务。可以补一条到当前阶段，或到路线图看本周安排。'
              : '今天还没有安排任务。生成规划后会出现在这里。'}
          </p>
          {hasPlan && onAddToday ? (
            <button
              type="button"
              disabled={addingToday}
              onClick={onAddToday}
              className="mt-3 rounded-full bg-white/20 px-4 py-1.5 text-xs font-medium text-white hover:bg-white/30 disabled:opacity-60"
            >
              {addingToday ? '正在补上…' : '补上今天的任务'}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* 打卡表单（需求 4.6），初始时长跟随所选快捷时长 */}
      <div className="mt-6">
        <CheckInForm initialDurationMinutes={selectedDuration} onSubmit={onCheckIn} />
      </div>
    </section>
  );
}

export default TodayTaskCard;
