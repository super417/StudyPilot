import { useEffect, useMemo, useState } from 'react';
import PurpleRing from '@/components/PurpleRing';
import WeeklyMetrics from '@/components/WeeklyMetrics';
import MasteryDetail from '@/components/MasteryDetail';
import { AnimatedText, FadeIn } from '@/components/motion';
import type { Metrics, WeeklyReview } from '@/mocks/types';
import { fetchLatestWeeklyReview, toWeeklyReview } from '@/lib/weeklyReviewsApi';
import { fetchOverviewMetrics, toMetrics } from '@/lib/studyApi';
import { todayISO } from '@/lib/dates';
import { ApiError } from '@/lib/httpClient';
import { usePlanSessionStore } from '@/store/planSessionStore';

/** 按是否有规划 / 周报，拼出与用户目标相关的说明文案。 */
function buildCopy(metrics: Metrics | null, review: WeeklyReview | null, empty: boolean) {
  const hasPlan = (metrics?.phaseProgress.total ?? 0) > 0;
  const phase = metrics?.phaseProgress;

  if (empty || !review) {
    return {
      eyebrow: 'WEEKLY REVIEW · 尚未生成',
      title: '一周之后，这里会帮你认识自己',
      description: hasPlan
        ? `你已有考研规划（阶段 ${phase?.completed ?? 0}/${phase?.total ?? 0}，剩余约 ${metrics?.remainingDays ?? 0} 天）。坚持打卡满一周后，周报会对照你的目标节奏，标出最容易进入状态、最有效与最容易卡住的部分。`
        : '周报不只汇总「学了多少」，还会告诉你什么时候最容易进入状态、什么方式最有效、什么最容易卡住。先在助手中提交学习目标并开始打卡吧。',
      emptyTitle: hasPlan
        ? '完成一周学习后自动生成第一份周报'
        : '完成一周学习后自动生成第一份周报',
      emptyBody: hasPlan
        ? `对照当前规划阶段（${phase?.completed ?? 0}/${phase?.total ?? 0}），StudyPilot 不会凭一两次表现给你贴标签；只有持续出现并得到你确认的模式，才会写进长期档案。`
        : 'StudyPilot 不会凭一两次表现给你贴标签；只有持续出现并得到你确认的模式，才会写进长期档案。',
    };
  }

  return {
    eyebrow: `WEEKLY REVIEW · ${review.weekStart} ~ ${review.weekEnd}`,
    title: '一周之后，这里会帮你认识自己',
    description: hasPlan
      ? `本周对照考研规划：阶段 ${phase?.completed ?? 0}/${phase?.total ?? 0}，剩余约 ${metrics?.remainingDays ?? 0} 天。投入 ${review.totalMinutes} 分钟 · 连续 ${review.streakDays} 天 · 完成率 ${review.completionRate}%。下面是本周知识掌握与节奏观察。`
      : `本周 ${review.weekStart} ~ ${review.weekEnd}。周报汇总投入、连续打卡与知识掌握，帮你看清考研节奏。`,
    emptyTitle: '',
    emptyBody: '',
  };
}

function WeeklyReviewPage() {
  const lastPlanId = usePlanSessionStore((s) => s.lastPlanId);
  const [review, setReview] = useState<WeeklyReview | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [empty, setEmpty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    const today = todayISO();
    try {
      const [weeklyRes, metricsRes] = await Promise.all([
        fetchLatestWeeklyReview(),
        fetchOverviewMetrics(today).catch(() => null),
      ]);
      if (metricsRes) setMetrics(toMetrics(metricsRes));
      else setMetrics(null);

      if (weeklyRes.empty || !weeklyRes.review) {
        setReview(null);
        setEmpty(true);
      } else {
        setReview(toWeeklyReview(weeklyRes.review));
        setEmpty(false);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '周报加载失败');
      setReview(null);
      setEmpty(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // 规划生成后阶段数会变，空态文案依赖这份指标。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPlanId]);

  const copy = useMemo(
    () => buildCopy(metrics, review, empty || !review),
    [metrics, review, empty],
  );

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <div role="alert" className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
          <button type="button" className="ml-3 underline" onClick={() => void reload()}>
            重试
          </button>
        </div>
      ) : null}

      {loading ? <p className="text-sm text-gray-400">加载考研周报…</p> : null}

      {!loading ? (
        <>
          {/* 顶部淡紫横幅 */}
          <FadeIn y={20}>
            <section className="flex flex-col gap-8 rounded-[28px] bg-[#EDE9FE] p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 max-w-2xl">
                <p className="text-[11px] font-semibold tracking-[0.12em] text-gray-500">
                  {copy.eyebrow}
                </p>
                <h1 className="mt-3 font-display text-3xl font-black leading-tight tracking-tight text-brandDark sm:text-4xl">
                  {copy.title}
                </h1>
                <AnimatedText
                  text={copy.description}
                  className="mt-4 text-sm leading-relaxed text-gray-500 sm:text-base"
                />
              </div>
              <div className="flex justify-center lg:justify-end">
                <PurpleRing percent={review?.masteryAvg ?? 0} />
              </div>
            </section>
          </FadeIn>

          {/* 三项指标 */}
          <WeeklyMetrics review={review} />

          {/* 底部：空态或掌握明细 */}
          {empty || !review ? (
            <FadeIn delay={0.12} y={20}>
              <section className="rounded-[28px] border border-brandFaint bg-card px-6 py-12 text-center shadow-card sm:px-10">
                <p className="font-display text-lg font-bold text-brandDark sm:text-xl">
                  {copy.emptyTitle}
                </p>
                <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-gray-500">
                  {copy.emptyBody}
                </p>
              </section>
            </FadeIn>
          ) : (
            <MasteryDetail items={review.masteryDetail} />
          )}
        </>
      ) : null}
    </div>
  );
}

export default WeeklyReviewPage;
