import type { Mistake } from '@/mocks/types';

export interface ReviewQueueCardProps {
  pendingCount: number;
  featured: Mistake | null;
  onOpenMistakes: () => void;
}

function statusHint(mistake: Mistake): string {
  if (mistake.reviewStatus === 'done') {
    return '已复习完成；隔一段时间可再抽查巩固。';
  }
  if (mistake.reviewStatus === 'scheduled') {
    return mistake.nextReviewAt
      ? `已安排复习 · 下次 ${mistake.nextReviewAt.slice(0, 10)}`
      : '已安排复习，表现仍可能不稳定，建议按计划回看。';
  }
  return '待复习：核心结论可能未稳，建议尽快重做并写清错因。';
}

/** 错题回顾队列：展示待复习数量与一条代表性错题。 */
function ReviewQueueCard({ pendingCount, featured, onOpenMistakes }: ReviewQueueCardProps) {
  return (
    <section className="flex h-full flex-col rounded-[28px] border border-brandFaint bg-card p-6 sm:p-7">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-dangerText">REVIEW QUEUE</p>
          <h3 className="mt-1 font-display text-2xl font-bold text-brandDark">能重新做的错题本</h3>
        </div>
        <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-dangerText px-2 text-sm font-bold text-white">
          {pendingCount}
        </span>
      </div>

      {featured ? (
        <div className="mt-6 flex flex-1 gap-3">
          <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-dangerText" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium leading-relaxed text-brandDark">{featured.question}</p>
                {featured.whyWrong ? (
                  <p className="mt-2 text-sm text-gray-400">{featured.whyWrong}</p>
                ) : null}
              </div>
              <span className="shrink-0 rounded-2xl bg-danger px-3 py-2 text-[11px] leading-snug text-dangerText sm:max-w-[11rem]">
                {statusHint(featured)}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-6 flex-1 text-sm text-gray-400">
          暂无待复习错题。在助手里整理错题后，会按复习状态出现在这里。
        </p>
      )}

      <button
        type="button"
        onClick={onOpenMistakes}
        className="mt-6 self-start text-sm font-medium text-gray-500 transition hover:text-brandDark"
      >
        查看题目、我的答案和错因 →
      </button>
    </section>
  );
}

export default ReviewQueueCard;
