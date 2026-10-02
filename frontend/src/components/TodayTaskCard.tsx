import { useState } from 'react';
import type { TodayStatus } from '@/mocks/types';
import CheckInForm from '@/components/CheckInForm';
import type { CheckInFormValues } from '@/components/CheckInForm';
import { Magnet } from '@/components/motion';

/** 时长快捷选项（分钟，需求 4.5） */
const DURATION_OPTIONS = [60, 75, 90] as const;

export interface TodayTaskCardProps {
  /** 今日任务状态徽标（未反馈 / 已安排 / 已完成，来自 metrics.todayStatus） */
  todayStatus: TodayStatus;
  /** 今日日期展示文案，默认占位「今天」 */
  date?: string;
  /**
   * 「开始今天的学习」点击回调（可选）。
   * 本步为前端交互占位，未传入时 console.log。
   */
  onStart?: (durationMinutes: number) => void;
  /** 完成打卡回调（可选），透传给内部 CheckInForm */
  onCheckIn?: (values: CheckInFormValues) => void;
}

/** 状态徽标配色（绿卡上用半透明白底，保持纯白文字风格） */
const STATUS_BADGE = 'bg-white/20 text-white';

/**
 * TodayTaskCard — 总览页右侧任务卡片（需求 4.4 / 4.5 / 12.6）
 *
 * 绿色渐变背景 + 纯白文字的大圆角卡片：展示今日日期、今日任务状态徽标、
 * 60/75/90 分钟时长快捷选项（本地 state 记录选中，选中态白底绿字），
 * 「开始今天的学习」主按钮（白底 brandDark 文字胶囊，前端占位），
 * 下半部内嵌 CheckInForm 打卡表单（需求 4.6）。
 *
 * 动效（任务 26 · 需求 18.4）：「开始今天的学习」按钮用 Magnet 包裹
 * （strength = 3、padding = 150，默认值），光标接近时朝光标方向磁吸位移。
 */
function TodayTaskCard({
  todayStatus,
  date = '今天',
  onStart,
  onCheckIn,
}: TodayTaskCardProps) {
  const [selectedDuration, setSelectedDuration] = useState<number>(DURATION_OPTIONS[0]);

  const handleStart = () => {
    if (onStart) {
      onStart(selectedDuration);
    } else {
      // 前端占位：开始学习的真实逻辑非本步范围。
      // eslint-disable-next-line no-console
      console.log('[TodayTaskCard] 开始今天的学习（前端占位）', { selectedDuration });
    }
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

      {/* 开始今天的学习（需求 4.4，前端占位），Magnet 磁吸包裹（需求 18.4） */}
      <Magnet strength={3} padding={150} className="mt-5">
        <button
          type="button"
          onClick={handleStart}
          className="w-full rounded-full bg-white px-6 py-3 text-sm font-semibold text-brandDark transition-shadow hover:shadow-[0_0_20px_rgba(255,255,255,0.45)]"
        >
          开始今天的学习
        </button>
      </Magnet>

      {/* 打卡表单（需求 4.6），初始时长跟随所选快捷时长 */}
      <div className="mt-6">
        <CheckInForm initialDurationMinutes={selectedDuration} onSubmit={onCheckIn} />
      </div>
    </section>
  );
}

export default TodayTaskCard;
