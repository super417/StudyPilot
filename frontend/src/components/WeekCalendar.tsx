export interface WeekDay {
  /** 星期标签，如「周一」 */
  weekday: string;
  /** 日期标签，如「09-21」 */
  date: string;
}

import { FadeIn } from '@/components/motion';

export interface WeekCalendarProps {
  /** 本周 7 天（周一→周日）；缺省用稳定 mock 周 */
  days?: WeekDay[];
  /** 今天在 days 中的下标（0-6）；缺省用 mock 高亮 */
  todayIndex?: number;
}

/**
 * 稳定 mock 周（对齐参考图 09-21 ~ 09-27，今天 09-23 周三高亮）。
 * 不接真实日期；生产接入后由调用方传入 days + todayIndex。
 */
const DEFAULT_WEEK: WeekDay[] = [
  { weekday: '周一', date: '09-21' },
  { weekday: '周二', date: '09-22' },
  { weekday: '周三', date: '09-23' },
  { weekday: '周四', date: '09-24' },
  { weekday: '周五', date: '09-25' },
  { weekday: '周六', date: '09-26' },
  { weekday: '周日', date: '09-27' },
];

const DEFAULT_TODAY_INDEX = 2;

/**
 * WeekCalendar — 总览页本周日历（需求 4.3）
 *
 * 横向排列周一到周日 7 张日期卡，显示星期 + 日期。
 * 「今天」那张卡用主色绿高亮加重，其余浅底。小屏横向可滚动。
 *
 * 动效（任务 26 · 需求 18.12）：进入视口时，第 i 张日期卡以 i × 0.05 秒的
 * 延迟交错入场（每张用 FadeIn 包裹，delay = i × 0.05）。FadeIn 内部 viewport.once
 * 保证只播一次。用 flex-1 保持等宽响应式，包裹层不改变原布局。
 */
function WeekCalendar({ days = DEFAULT_WEEK, todayIndex = DEFAULT_TODAY_INDEX }: WeekCalendarProps) {
  return (
    <section className="card p-6 sm:p-8">
      <p className="text-sm font-semibold text-brandDark">本周</p>
      <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
        {days.map((day, index) => {
          const isToday = index === todayIndex;
          return (
            // 交错入场：第 i 张卡延迟 i × 0.05 秒（需求 18.12）。
            <FadeIn
              key={`${day.weekday}-${day.date}`}
              delay={index * 0.05}
              y={16}
              className="flex min-w-[64px] flex-1"
            >
              <div
                aria-current={isToday ? 'date' : undefined}
                className={[
                  'flex w-full flex-col items-center gap-1 rounded-2xl px-3 py-4 text-center',
                  isToday
                    ? 'bg-brand text-white shadow-card'
                    : 'bg-brandFaint/40 text-gray-600',
                ].join(' ')}
              >
                <span
                  className={[
                    'text-xs',
                    isToday ? 'font-medium text-white/90' : 'text-gray-400',
                  ].join(' ')}
                >
                  {day.weekday}
                </span>
                <span
                  className={[
                    'font-display text-lg font-bold leading-none',
                    isToday ? 'text-white' : 'text-brandDark',
                  ].join(' ')}
                >
                  {day.date}
                </span>
                {isToday ? (
                  <span className="text-[10px] font-medium text-white/90">今天</span>
                ) : null}
              </div>
            </FadeIn>
          );
        })}
      </div>
    </section>
  );
}

export default WeekCalendar;
