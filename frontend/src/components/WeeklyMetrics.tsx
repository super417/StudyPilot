import type { WeeklyReview } from '@/mocks/types';
import { FadeIn, InteractiveCard } from '@/components/motion';

export interface WeeklyMetricsProps {
  /** 有周报时用真实值；没有周报时显示「暂无数据」，不用 0 冒充。 */
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
      value: review == null ? '暂无数据' : `${review.totalMinutes}m`,
      footer: '持续累积',
    },
    {
      label: '连续天数',
      value: review == null ? '暂无数据' : `${review.streakDays}`,
      footer: '中断后将重来',
    },
    {
      label: '任务完成率',
      value: review == null ? '暂无数据' : `${review.completionRate}%`,
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
