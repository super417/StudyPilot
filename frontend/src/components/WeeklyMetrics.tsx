import type { WeeklyReview } from '@/mocks/types';
import { FadeIn, InteractiveCard } from '@/components/motion';

export interface WeeklyMetricsProps {
  /** 有周报时用真实值；为空时展示 0 占位（与设计稿一致）。 */
  review: Pick<WeeklyReview, 'totalMinutes' | 'streakDays' | 'completionRate'> | null;
}

interface MetricItem {
  label: string;
  value: string;
  footer: string;
}

function WeeklyMetrics({ review }: WeeklyMetricsProps) {
  const items: MetricItem[] = [
    {
      label: '累计投入',
      value: `${review?.totalMinutes ?? 0}m`,
      footer: '持续累积',
    },
    {
      label: '连续天数',
      value: `${review?.streakDays ?? 0}`,
      footer: '中断后将重来',
    },
    {
      label: '任务完成率',
      value: `${review?.completionRate ?? 0}%`,
      footer: '滚动增长',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {items.map((item, i) => (
        <FadeIn key={item.label} delay={i * 0.1} y={24}>
          <InteractiveCard className="rounded-[24px] border border-brandFaint/80 bg-card p-6 shadow-card">
            <p className="text-xs font-medium text-gray-400">{item.label}</p>
            <p className="mt-3 font-display text-3xl font-bold leading-none text-brandDark sm:text-4xl">
              {item.value}
            </p>
            <p className="mt-4 text-[11px] text-gray-400">{item.footer}</p>
          </InteractiveCard>
        </FadeIn>
      ))}
    </div>
  );
}

export default WeeklyMetrics;
