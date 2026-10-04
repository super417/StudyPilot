import { BarChart3 } from 'lucide-react';
import CardShell from './CardShell';
import { CardError, CardLoading } from './states';
import { useAsync } from './useAsync';
import { fetchStudyStats } from '@/lib/profileStudyApi';
import { usePlanSessionStore } from '@/store/planSessionStore';

/** 迷你趋势柱状图（纯 SVG，不引入图表库）。 */
function MiniTrend({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const width = 132;
  const height = 40;
  const gap = 4;
  const barWidth = (width - gap * (values.length - 1)) / values.length;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="近 7 日学习时长趋势">
      {values.map((v, i) => {
        const h = Math.max(2, (v / max) * height);
        return (
          <rect
            key={i}
            x={i * (barWidth + gap)}
            y={height - h}
            width={barWidth}
            height={h}
            rx={2}
            fill={i === values.length - 1 ? '#10B981' : '#A7F3D0'}
          />
        );
      })}
    </svg>
  );
}

interface StatItem {
  label: string;
  value: string;
}

/** 学习统计卡片：连续天数、本周时长、完成任务、知识点掌握 + 迷你趋势。 */
function StudyStatsCard() {
  const lastPlanId = usePlanSessionStore((s) => s.lastPlanId);
  const { data, loading, error } = useAsync(fetchStudyStats, lastPlanId);

  const items: StatItem[] = data
    ? [
        { label: '连续学习', value: `${data.streakDays} 天` },
        { label: '投入时长', value: `${Math.round(data.weeklyMinutes / 60)} 小时` },
        { label: '本周完成任务', value: `${data.completedTasks} 个` },
        { label: '周报掌握度', value: `${data.masteryPercent}%` },
      ]
    : [];

  return (
    <CardShell title="学习统计" icon={<BarChart3 size={17} aria-hidden="true" />}>
      {loading ? (
        <CardLoading />
      ) : error ? (
        <CardError message={error} />
      ) : data ? (
        <div>
          <div className="grid grid-cols-2 gap-4">
            {items.map((item) => (
              <div key={item.label}>
                <p className="text-xs text-gray-400">{item.label}</p>
                <p className="mt-1 font-display text-2xl font-bold leading-none text-brandDark">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-5 border-t border-brandFaint pt-4">
            <p className="mb-2 text-xs text-gray-400">近 7 日任务活跃</p>
            <MiniTrend values={data.weeklyTrend} />
          </div>
        </div>
      ) : null}
    </CardShell>
  );
}

export default StudyStatsCard;
