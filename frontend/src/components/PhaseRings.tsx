import { useEffect, useState } from 'react';
import type { MasteryDetailItem, ReinforceOutcome } from '@/mocks/types';

/**
 * 完成度比掌握度高出这么多（百分点）才标出差距。
 * 经验值，非研究结论，可调。
 * 与 backend ``app.services.divergence.DIVERGENCE_THRESHOLD`` 保持一致。
 */
export const DIVERGENCE_THRESHOLD = 30;

const TRACK = '#E9E5F5';
const OUTER_COLOR = '#A78BFA'; // 浅紫：完成度
const INNER_COLOR = '#7C3AED'; // 与之匹配的深紫：掌握度
const MISSING_COLOR = '#C4B5FD';

export interface PhaseRingsProps {
  items: MasteryDetailItem[];
  /** 背离出现时，由页面发起补强预览。不传则不显示入口。 */
  onRequestReinforce?: () => void;
  reinforceBusy?: boolean;
  /** 按 phaseId 索引；有条目才显示补强前后对比（重测入口在页面「触发补强」卡片）。 */
  reinforceOutcomesByPhase?: Record<string, ReinforceOutcome>;
}

function formatOverall(outcome: ReinforceOutcome): string {
  const { percent, evidenceCount } = outcome.overall;
  if (percent == null) {
    return `阶段掌握度 暂无证据（基于 ${evidenceCount} 次）`;
  }
  return `阶段掌握度 ${percent}%（基于 ${evidenceCount} 次）`;
}

function formatAfterDetail(outcome: ReinforceOutcome): string {
  if (outcome.after.evidenceCount === 0) {
    return '尚未重测';
  }
  const n = outcome.after.evidenceCount;
  const correct = outcome.after.correctCount ?? 0;
  return `补强后新增 ${n} 次作答，其中 ${correct} 次正确`;
}

/** 与掌握度分布 AnimatedRing 同款：灰底轨、厚环、圆角端、进入动画、悬停加粗 */
function DualRing({
  completion,
  mastery,
  label,
}: {
  completion: number | null;
  mastery: number | null;
  label: string;
}) {
  const size = 168;
  const stroke = 16;
  const hoverStroke = 22;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = (size - stroke) / 2 - 2;
  const innerR = outerR - stroke - 6;
  const outerC = 2 * Math.PI * outerR;
  const innerC = 2 * Math.PI * innerR;

  const [drawn, setDrawn] = useState(false);
  const [hover, setHover] = useState<'outer' | 'inner' | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, [completion, mastery]);

  const outerLen =
    completion == null ? 0 : (Math.max(0, Math.min(100, completion)) / 100) * outerC;
  const innerLen =
    mastery == null ? 0 : (Math.max(0, Math.min(100, mastery)) / 100) * innerC;

  const ringStyle = (active: boolean) => ({
    transition:
      'stroke-dasharray 0.85s cubic-bezier(0.22, 1, 0.36, 1), stroke-width 0.18s ease-out',
    cursor: 'pointer' as const,
    filter: active ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.12))' : undefined,
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className="shrink-0 overflow-visible"
      onMouseLeave={() => setHover(null)}
    >
      {/* 外圈底轨 + 完成度 */}
      <circle
        cx={cx}
        cy={cy}
        r={outerR}
        fill="none"
        stroke={TRACK}
        strokeWidth={stroke}
        strokeLinecap="butt"
      />
      <g style={{ transformOrigin: `${cx}px ${cy}px`, transform: 'rotate(-90deg)' }}>
        <circle
          cx={cx}
          cy={cy}
          r={outerR}
          fill="none"
          stroke={completion == null ? MISSING_COLOR : OUTER_COLOR}
          strokeWidth={hover === 'outer' ? hoverStroke : stroke}
          strokeLinecap="round"
          strokeDasharray={
            completion == null
              ? '4 6'
              : drawn
                ? `${outerLen} ${Math.max(outerC - outerLen, 0)}`
                : `0 ${outerC}`
          }
          style={ringStyle(hover === 'outer')}
          onMouseEnter={() => setHover('outer')}
        >
          <title>
            {completion == null ? '本周无任务' : `完成度 ${completion}%`}
          </title>
        </circle>
      </g>

      {/* 内圈底轨 + 掌握度 */}
      <circle
        cx={cx}
        cy={cy}
        r={innerR}
        fill="none"
        stroke={TRACK}
        strokeWidth={stroke}
        strokeLinecap="butt"
      />
      <g style={{ transformOrigin: `${cx}px ${cy}px`, transform: 'rotate(-90deg)' }}>
        <circle
          cx={cx}
          cy={cy}
          r={innerR}
          fill="none"
          stroke={mastery == null ? MISSING_COLOR : INNER_COLOR}
          strokeWidth={hover === 'inner' ? hoverStroke : stroke}
          strokeLinecap="round"
          strokeDasharray={
            mastery == null
              ? '4 6'
              : drawn
                ? `${innerLen} ${Math.max(innerC - innerLen, 0)}`
                : `0 ${innerC}`
          }
          style={ringStyle(hover === 'inner')}
          onMouseEnter={() => setHover('inner')}
        >
          <title>
            {mastery == null ? '暂无掌握度证据' : `掌握度 ${mastery}%`}
          </title>
        </circle>
      </g>
    </svg>
  );
}

function PhaseRing({
  item,
  onRequestReinforce,
  reinforceBusy,
  outcome,
}: {
  item: MasteryDetailItem;
  onRequestReinforce?: () => void;
  reinforceBusy?: boolean;
  outcome?: ReinforceOutcome;
}) {
  const completion = item.completionRate ?? null;
  const mastery = item.percent;
  const completionMissing = completion == null;
  const masteryMissing = mastery == null;
  const gap = completion != null && mastery != null ? completion - mastery : null;
  const diverged = gap != null && gap >= DIVERGENCE_THRESHOLD;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-slate-100 bg-white p-4 sm:flex-row sm:items-center">
      <DualRing
        completion={completion}
        mastery={mastery}
        label={`${item.subject} 的完成度与掌握度`}
      />
      <div className="min-w-0 flex-1 space-y-1.5 text-sm text-slate-600">
        <p className="text-base font-semibold text-slate-800">{item.subject}</p>
        <p className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: OUTER_COLOR }} />
          <span>
            {completionMissing
              ? '本周无任务'
              : `完成度 ${completion}%（${item.taskDone ?? 0}/${item.taskTotal ?? 0}）`}
          </span>
        </p>
        <p className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: INNER_COLOR }} />
          <span>
            {masteryMissing
              ? '暂无掌握度证据'
              : typeof item.evidenceCount === 'number'
                ? `掌握度 ${mastery}% · 基于 ${item.evidenceCount} 次作答`
                : `掌握度 ${mastery}%`}
          </span>
        </p>
        {outcome ? (
          <>
            <p className="text-slate-700">{formatOverall(outcome)}</p>
            <p className="text-slate-700">{formatAfterDetail(outcome)}</p>
          </>
        ) : null}
        {diverged ? (
          <p className="font-medium text-purple">
            完成度高于掌握度 {gap} 点
          </p>
        ) : null}
        {diverged && onRequestReinforce ? (
          <button
            type="button"
            className="mt-1 text-sm font-medium text-purple underline-offset-2 hover:underline disabled:opacity-50"
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

function PhaseRings({
  items,
  onRequestReinforce,
  reinforceBusy,
  reinforceOutcomesByPhase,
}: PhaseRingsProps) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-400">本周期暂无掌握度证据</p>;
  }
  return (
    <ul className="flex flex-col gap-4">
      {items.map((item) => {
        const phaseId = item.phaseId;
        const outcome =
          phaseId && reinforceOutcomesByPhase
            ? reinforceOutcomesByPhase[phaseId]
            : undefined;
        return (
          <PhaseRing
            key={phaseId ?? item.subject}
            item={item}
            onRequestReinforce={onRequestReinforce}
            reinforceBusy={reinforceBusy}
            outcome={outcome}
          />
        );
      })}
    </ul>
  );
}

export default PhaseRings;
