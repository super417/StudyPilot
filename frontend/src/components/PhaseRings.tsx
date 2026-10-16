import type { MasteryDetailItem } from '@/mocks/types';

/**
 * 完成度比掌握度高出这么多（百分点）才标出差距。
 * 经验值，非研究结论，可调。
 * 与 backend ``app.services.divergence.DIVERGENCE_THRESHOLD`` 保持一致。
 */
export const DIVERGENCE_THRESHOLD = 30;

export interface PhaseRingsProps {
  items: MasteryDetailItem[];
  /** 背离出现时，由页面发起补强预览。不传则不显示入口。 */
  onRequestReinforce?: () => void;
  reinforceBusy?: boolean;
}

function ringGeometry(radius: number, value: number | null) {
  const circumference = 2 * Math.PI * radius;
  if (value == null) {
    return { dash: '4 4', color: '#9CA3AF' };
  }
  const drawn = (Math.max(0, Math.min(100, value)) / 100) * circumference;
  return { dash: `${drawn} ${circumference}`, color: '#8B5CF6' };
}

function PhaseRing({
  item,
  onRequestReinforce,
  reinforceBusy,
}: {
  item: MasteryDetailItem;
  onRequestReinforce?: () => void;
  reinforceBusy?: boolean;
}) {
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
          {masteryMissing
            ? '暂无掌握度证据'
            : typeof item.evidenceCount === 'number'
              ? `掌握度 ${mastery}% · 基于 ${item.evidenceCount} 次作答`
              : `掌握度 ${mastery}%`}
        </p>
        {diverged ? (
          <p className="mt-2 text-sm font-medium text-purple">
            完成度高于掌握度 {gap} 点
          </p>
        ) : null}
        {diverged && onRequestReinforce ? (
          <button
            type="button"
            className="mt-3 text-sm font-medium text-purple underline-offset-2 hover:underline disabled:opacity-50"
            disabled={reinforceBusy}
            onClick={onRequestReinforce}
          >
            {reinforceBusy ? '正在生成补强预览…' : '生成补强任务'}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function PhaseRings({ items, onRequestReinforce, reinforceBusy }: PhaseRingsProps) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-400">本周期暂无掌握度证据</p>;
  }
  return (
    <ul className="flex flex-col gap-4">
      {items.map((item) => (
        <PhaseRing
          key={item.phaseId ?? item.subject}
          item={item}
          onRequestReinforce={onRequestReinforce}
          reinforceBusy={reinforceBusy}
        />
      ))}
    </ul>
  );
}

export default PhaseRings;
