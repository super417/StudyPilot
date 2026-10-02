import type { Metrics } from '@/mocks/types';

export interface MetricsRowProps {
  /** 总览页学习指标 */
  metrics: Metrics;
}

interface MetricItem {
  /** 突出显示的数值（含单位分隔时拆为 value + suffix） */
  value: string;
  /** 数值后缀（如「天」「分钟」） */
  suffix?: string;
  /** 小号标签 */
  label: string;
}

/**
 * MetricsRow — 总览页四项学习指标（需求 4.2）
 *
 * 纯静态 UI：一排展示剩余天数、累计打卡分钟、连续打卡天数、阶段进度。
 * 数值用 font-display（Kanit）大字加粗、brandDark 突出；标签小号灰字。
 * 布局响应式：手机两列、大屏一排四项。无任何动效。
 */
function MetricsRow({ metrics }: MetricsRowProps) {
  const items: MetricItem[] = [
    { value: String(metrics.remainingDays), suffix: '天到初试', label: '剩余天数' },
    { value: String(metrics.totalMinutes), suffix: '分钟已打卡', label: '累计投入' },
    { value: String(metrics.streakDays), suffix: '连续天数', label: '打卡坚持' },
    {
      value: `${metrics.phaseProgress.completed} / ${metrics.phaseProgress.total}`,
      suffix: '个阶段',
      label: '阶段进度',
    },
  ];

  return (
    <section className="card p-6 sm:p-8">
      <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <p className="text-xs font-medium text-gray-400">{item.label}</p>
            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="font-display text-3xl font-bold leading-none text-brandDark sm:text-4xl">
                {item.value}
              </span>
              {item.suffix ? (
                <span className="text-sm text-gray-500">{item.suffix}</span>
              ) : null}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default MetricsRow;
