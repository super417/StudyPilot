import PurpleRing from '@/components/PurpleRing';
import WeeklyMetrics from '@/components/WeeklyMetrics';
import type { WeeklyReview } from '@/mocks/types';

export interface StatisticsWeeklyReviewProps {
  review: WeeklyReview | null;
  empty: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

/**
 * 数据统计页顶部「学习周报」：紫环 + 三指标。
 * 复用已有 review state；与下方「阶段双环」（补强前后对比）分开。
 */
function StatisticsWeeklyReview({
  review,
  empty,
  loading = false,
  error = null,
  onRetry,
}: StatisticsWeeklyReviewProps) {
  const noEvidence =
    empty ||
    !review ||
    (review.masteryDetail ?? []).every((item) => (item.evidenceCount ?? 0) === 0);

  return (
    <section
      className="rounded-2xl bg-[#EDE9FE]/60 p-6 shadow-sm ring-1 ring-slate-100"
      aria-labelledby="statistics-weekly-review-heading"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="statistics-weekly-review-heading"
            className="text-base font-semibold text-slate-800"
          >
            学习周报
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {review
              ? `${review.weekStart} ~ ${review.weekEnd} · 本周掌握与节奏`
              : '完成一周学习后，这里会汇总本周掌握与投入'}
          </p>
        </div>
      </div>

      {error ? (
        <div role="alert" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {error}
          {onRetry ? (
            <button type="button" className="ml-3 underline" onClick={onRetry}>
              重试
            </button>
          ) : null}
        </div>
      ) : null}

      {loading && !error ? (
        <p className="mt-6 py-8 text-center text-sm text-slate-400">加载学习周报…</p>
      ) : null}

      {!loading && !error ? (
        <div className="mt-6 flex flex-col items-center gap-8 lg:flex-row lg:items-center lg:justify-between">
          <PurpleRing percent={review?.masteryAvg ?? 0} empty={noEvidence} />
          <div className="w-full min-w-0 flex-1">
            <WeeklyMetrics review={empty || !review ? null : review} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default StatisticsWeeklyReview;
