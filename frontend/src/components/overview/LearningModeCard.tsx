import type { LearningInsight } from '@/lib/overviewInsights';

export interface LearningModeCardProps {
  weekLabel: string;
  insights: LearningInsight[];
  onOpenWeekly: () => void;
}

/** 深色「学习模式」洞察卡：三条由用户 metrics / 任务推导。 */
function LearningModeCard({ weekLabel, insights, onOpenWeekly }: LearningModeCardProps) {
  return (
    <section className="flex h-full flex-col rounded-[28px] bg-[#0B1220] p-6 text-white sm:p-7">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-purple">STUDYPILOT NOTICED</p>
          <h3 className="mt-1 font-display text-2xl font-bold">你的学习模式</h3>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 text-xs font-semibold text-white/80">
          {weekLabel}
        </span>
      </div>

      <ol className="mt-6 flex flex-1 flex-col divide-y divide-white/10">
        {insights.map((item) => (
          <li key={item.index} className="py-4 first:pt-0 last:pb-0">
            <p className="text-[11px] font-semibold tracking-wide text-purple">
              {item.index} {item.kind}
            </p>
            <p className="mt-1 text-base font-semibold text-white">{item.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-white/65">{item.body}</p>
            <p className="mt-2 text-[11px] text-white/40">{item.evidence}</p>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={onOpenWeekly}
        className="mt-6 flex w-full items-center justify-between rounded-full bg-white px-5 py-3 text-sm font-semibold text-brandDark transition hover:bg-brandFaint"
      >
        打开学习周报
        <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}

export default LearningModeCard;
