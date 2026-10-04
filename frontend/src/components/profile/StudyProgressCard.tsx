import { TrendingUp, ChevronRight } from 'lucide-react';
import CardShell from './CardShell';
import { CardError, CardLoading } from './states';
import { useAsync } from './useAsync';
import { fetchStudyProgress } from '@/lib/profileStudyApi';
import { usePlanSessionStore } from '@/store/planSessionStore';

export interface StudyProgressCardProps {
  onEnter: () => void;
}

const RING_SIZE = 92;
const RING_STROKE = 10;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

/** 学习进度：真实 metrics 阶段进度 + 今日三态 + 本周任务完成比。 */
function StudyProgressCard({ onEnter }: StudyProgressCardProps) {
  const lastPlanId = usePlanSessionStore((s) => s.lastPlanId);
  const { data, loading, error } = useAsync(fetchStudyProgress, lastPlanId);

  const weeklyPercent =
    data && data.weeklyGoalMinutes > 0
      ? Math.min(100, Math.round((data.weeklyDoneMinutes / data.weeklyGoalMinutes) * 100))
      : 0;

  return (
    <CardShell
      title="学习进度"
      icon={<TrendingUp size={17} aria-hidden="true" />}
      action={
        <button
          type="button"
          onClick={onEnter}
          className="flex items-center gap-0.5 rounded-full px-2 py-1 text-sm text-brand transition hover:bg-brandFaint"
        >
          进入
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      }
    >
      {loading ? (
        <CardLoading />
      ) : error ? (
        <CardError message={error} />
      ) : data ? (
        <div className="flex items-center gap-5">
          <div
            className="relative shrink-0"
            style={{ width: RING_SIZE, height: RING_SIZE }}
            role="img"
            aria-label={`总体进度 ${data.overallPercent}%`}
          >
            <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke="#D1FAE5"
                strokeWidth={RING_STROKE}
              />
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke="#10B981"
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={RING_CIRC}
                strokeDashoffset={RING_CIRC * (1 - data.overallPercent / 100)}
                transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-display text-lg font-bold text-brandDark">
                {data.overallPercent}%
              </span>
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="text-xs text-gray-400">今日状态</p>
              <p className="text-sm font-medium text-brandDark">
                {data.todayStatus ?? '未反馈'}
                {data.todayMinutes > 0 ? (
                  <span className="ml-2 text-gray-400">
                    · {formatMinutes(data.todayMinutes)}
                  </span>
                ) : null}
              </p>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">
                  {data.weekTaskMode ? '本周任务' : '本周目标'}
                </span>
                <span className="text-gray-500">{weeklyPercent}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-brandFaint">
                <div
                  className="h-full rounded-full bg-brand transition-all"
                  style={{ width: `${weeklyPercent}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {data.weekTaskMode
                  ? `${data.weeklyDoneMinutes} / ${data.weeklyGoalMinutes} 项`
                  : `${formatMinutes(data.weeklyDoneMinutes)} / ${formatMinutes(data.weeklyGoalMinutes)}`}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </CardShell>
  );
}

export default StudyProgressCard;
