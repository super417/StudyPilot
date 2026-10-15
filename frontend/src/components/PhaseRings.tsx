import type { MasteryDetailItem } from '@/mocks/types';

/**
 * 完成度比掌握度高出这么多（百分点）才标出差距。
 * 这是产品判断值，可调。
 */
export const DIVERGENCE_THRESHOLD = 30;

export interface PhaseRingsProps {
  items: MasteryDetailItem[];
}

function ringGeometry(radius: number, value: number | null) {
  const circumference = 2 * Math.PI * radius;
  if (value == null) {
    return { dash: '4 4', color: '#9CA3AF' };
  }
  const drawn = (Math.max(0, Math.min(100, value)) / 100) * circumference;
  return { dash: `${drawn} ${circumference}`, color: '#8B5CF6' };
}

function PhaseRing({ item }: { item: MasteryDetailItem }) {
  const size = 112;
  const center = size / 2;
  const outer = ringGeometry(42, item.completionRate ?? null);
  const inner = ringGeometry(28, item.percent);
  const completion = item.completionRate ?? null;
  const mastery = item.percent;
  const completionMissing = completion == null;
  const masteryMissing = mastery == null;
  const gap = completion != null && mastery != null ? completion - mastery : null;
  const diverged = gap != null && gap >= DIVERGENCE_THRESHOLD;

  return (
    <li className="flex flex-col gap-3 rounded-[28px] border border-brandFaint bg-card p-5 sm:flex-row sm:items-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${item.subject} 的完成度与掌握度`}
        className="shrink-0"
      >
        <circle
          cx={center}
          cy={center}
          r={42}
          fill="none"
          stroke={outer.color}
          strokeWidth={8}
          strokeDasharray={outer.dash}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
        <circle
          cx={center}
          cy={center}
          r={28}
          fill="none"
          stroke={inner.color}
          strokeWidth={8}
          strokeDasharray={inner.dash}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <div className="min-w-0">
        <p className="font-display text-base font-bold text-brandDark">{item.subject}</p>
        <p className="mt-2 text-sm text-brandDark">
          {completionMissing
            ? '本周无任务'
            : `完成度 ${completion}%（${item.taskDone ?? 0}/${item.taskTotal ?? 0}）`}
        </p>
        <p className="mt-1 text-sm text-brandDark">
          {masteryMissing ? '暂无掌握度证据' : `掌握度 ${mastery}%`}
        </p>
        {diverged ? (
          <p className="mt-2 text-sm font-medium text-purple">
            完成度高于掌握度 {gap} 点
          </p>
        ) : null}
      </div>
    </li>
  );
}

function PhaseRings({ items }: PhaseRingsProps) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-400">本周期暂无掌握度证据</p>;
  }
  return (
    <ul className="flex flex-col gap-4">
      {items.map((item) => (
        <PhaseRing key={item.phaseId ?? item.subject} item={item} />
      ))}
    </ul>
  );
}

export default PhaseRings;
