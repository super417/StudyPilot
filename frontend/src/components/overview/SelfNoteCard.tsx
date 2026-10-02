export interface SelfNoteCardProps {
  headline: string;
  recentLabel: string;
  nextStep: string;
}

/** 浅绿「近期自述」卡：由周报 / 指标拼出的真实摘要。 */
function SelfNoteCard({ headline, recentLabel, nextStep }: SelfNoteCardProps) {
  return (
    <section className="flex h-full flex-col justify-between rounded-[28px] bg-brandLight p-6 text-brandDark sm:p-7">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.14em] text-brandDark/55">
          RECENT · SELF NOTE
        </p>
        <p className="mt-5 font-display text-xl font-bold leading-snug sm:text-2xl">{headline}</p>
      </div>
      <div className="mt-8 flex flex-wrap items-end justify-between gap-3 text-xs text-brandDark/70">
        <span>{recentLabel}</span>
        <span className="text-right">{nextStep}</span>
      </div>
    </section>
  );
}

export default SelfNoteCard;
