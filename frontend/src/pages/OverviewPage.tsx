import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import GoalCard from '@/components/GoalCard';
import MetricsRow from '@/components/MetricsRow';
import WeekCalendar from '@/components/WeekCalendar';
import TodayTaskCard from '@/components/TodayTaskCard';
import LearningModeCard from '@/components/overview/LearningModeCard';
import MasteryOverviewCard from '@/components/overview/MasteryOverviewCard';
import ReviewQueueCard from '@/components/overview/ReviewQueueCard';
import SelfNoteCard from '@/components/overview/SelfNoteCard';
import { FadeIn, StickyStack } from '@/components/motion';
import type { TabKey } from '@/components/TabNav';
import type { CheckInFormValues } from '@/components/CheckInForm';
import type { DailyTask, Metrics, Mistake, Plan, WeeklyReview } from '@/mocks/types';
import { todayISO, addDaysISO, currentWeekCalendar } from '@/lib/dates';
import {
  createCheckIn,
  fetchDailyTasks,
  fetchOverviewMetrics,
  addTodayTask,
  setDailyTaskStatus,
  toMetrics,
} from '@/lib/studyApi';
import { createRemedyPreview, fetchLatestPlan } from '@/lib/plansApi';
import { fetchLatestWeeklyReview, toWeeklyReview } from '@/lib/weeklyReviewsApi';
import {
  dueFirst,
  getMistake,
  listMistakes,
  listItemToMistake,
  requestMistakeFilter,
} from '@/lib/mistakesApi';
import {
  buildLearningInsights,
  buildSelfNote,
  isoWeekLabel,
} from '@/lib/overviewInsights';
import { ApiError } from '@/lib/httpClient';
import { useAssistantStore } from '@/store';
import { usePlanSessionStore } from '@/store/planSessionStore';
import StudyPilotPostcards from '@/components/StudyPilotPostcards';
import DailyStartDialog from '@/components/overview/DailyStartDialog';
import OverviewDetailsDialog from '@/components/overview/OverviewDetailsDialog';
import type { OverviewAction, PostcardsOverview } from '@/lib/postcardsOverview';

export interface OverviewPageProps {
  onNavigate?: (tab: TabKey) => void;
  presentation?: 'legacy' | 'postcards';
}

/** 无 Plan GET 时，用 metrics 拼展示用规划卡（不伪造 AI 内容）。 */
function planFromMetrics(metrics: Metrics, today: string): Plan | null {
  if (metrics.phaseProgress.total <= 0) return null;
  const remaining = metrics.remainingDays;
  return {
    id: 'derived-latest',
    goalName: '当前学习规划',
    subtitle: `剩余 ${remaining} 天 · 阶段 ${metrics.phaseProgress.completed}/${metrics.phaseProgress.total}`,
    startDate: addDaysISO(today, -Math.max(1, 30 - Math.min(remaining, 30))),
    goalDate: addDaysISO(today, remaining),
    currentLevel: '',
    dailyMinutes: 0,
    totalPhases: metrics.phaseProgress.total,
    updatedAt: today,
  };
}

function OverviewPage({ onNavigate, presentation = 'postcards' }: OverviewPageProps = {}) {
  const today = todayISO();
  const openAssistantWithContext = useAssistantStore((s) => s.openAssistantWithContext);
  const lastPlanId = usePlanSessionStore((s) => s.lastPlanId);
  const planDataEpoch = usePlanSessionStore((s) => s.planDataEpoch);
  const setActivePlanId = usePlanSessionStore((s) => s.setActivePlanId);
  const setPendingAdjustment = usePlanSessionStore((s) => s.setPendingAdjustment);
  const go = (tab: TabKey) => onNavigate?.(tab);

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [todayTasks, setTodayTasks] = useState<DailyTask[]>([]);
  const [review, setReview] = useState<WeeklyReview | null>(null);
  const [featuredMistake, setFeaturedMistake] = useState<Mistake | null>(null);
  const [pendingMistakeCount, setPendingMistakeCount] = useState(0);
  const [dueMistakeCount, setDueMistakeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkInMsg, setCheckInMsg] = useState<string | null>(null);
  const [addingToday, setAddingToday] = useState(false);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [dialog, setDialog] = useState<'goal' | 'tasks' | 'checkin' | 'mastery' | 'weekly' | null>(null);
  const [starting, setStarting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [metricsRes, tasksRes, weeklyRes, mistakesRes, latestPlan] = await Promise.all([
        fetchOverviewMetrics(today),
        fetchDailyTasks(today).catch(() => ({ status: 'ok', tasks: [] as DailyTask[], unavailable: true })),
        fetchLatestWeeklyReview().catch(() => ({
          status: 'ok',
          review: null,
          empty: true,
          unavailable: true,
        })),
        listMistakes().catch(() => ({
          status: 'ok',
          pendingCount: 0,
          dueCount: 0,
          unavailable: true,
          mistakes: [] as Array<{
            id: string;
            question: string;
            reviewStatus: Mistake['reviewStatus'];
            nextReviewAt?: string | null;
            due?: boolean;
            createdAt: string;
          }>,
        })),
        fetchLatestPlan().catch(() => ({
          status: 'ok',
          empty: true,
          plan: null,
          phases: [],
        })),
      ]);

      const nextMetrics = toMetrics(metricsRes);
      setUnavailable([
        ...('unavailable' in tasksRes ? ['tasks'] : []),
        ...('unavailable' in weeklyRes ? ['review'] : []),
        ...('unavailable' in mistakesRes ? ['mistakes'] : []),
      ]);
      setMetrics(nextMetrics);
      setTodayTasks(tasksRes.tasks ?? []);
      setReview(
        weeklyRes.review && !weeklyRes.empty ? toWeeklyReview(weeklyRes.review) : null,
      );
      setPendingMistakeCount(mistakesRes.pendingCount ?? 0);

      if (latestPlan.plan) {
        setPlan({
          id: latestPlan.plan.id,
          goalName: latestPlan.plan.goalName,
          subtitle: latestPlan.plan.subtitle || latestPlan.plan.currentLevel,
          startDate: latestPlan.plan.startDate,
          goalDate: latestPlan.plan.goalDate,
          currentLevel: latestPlan.plan.currentLevel,
          dailyMinutes: latestPlan.plan.dailyMinutes,
          completionCriterion: latestPlan.plan.completionCriterion ?? null,
          totalPhases: latestPlan.plan.totalPhases,
          updatedAt: latestPlan.plan.updatedAt.slice(0, 10),
        });
      } else {
        setPlan(planFromMetrics(nextMetrics, today));
      }

      setDueMistakeCount(mistakesRes.dueCount ?? 0);
      const queue = dueFirst(mistakesRes.mistakes ?? []).filter(
        (m) => m.reviewStatus === 'pending' || m.reviewStatus === 'scheduled',
      );
      const head = queue[0] ?? mistakesRes.mistakes?.[0] ?? null;
      if (head) {
        try {
          const detail = await getMistake(head.id);
          setFeaturedMistake({ ...detail.mistake, due: head.due ?? false });
        } catch {
          setFeaturedMistake(listItemToMistake(head));
        }
      } else {
        setFeaturedMistake(null);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '指标加载失败，请稍后重试');
      setMetrics(null);
      setPlan(null);
      setTodayTasks([]);
      setReview(null);
      setUnavailable(['tasks', 'review', 'mistakes']);
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    void reload();
  }, [reload, lastPlanId, planDataEpoch]);

  const handleToggleTask = async (task: DailyTask) => {
    const next = task.status === 'done' ? 'pending' : 'done';
    setCheckInMsg(null);
    try {
      await setDailyTaskStatus(task.id, next);
      setCheckInMsg(
        next === 'done' ? '已标记完成；阶段进度与当前阶段会跟着更新' : '已改回待完成',
      );
      await reload();
    } catch (e) {
      setCheckInMsg(e instanceof ApiError ? e.message : '更新任务状态失败');
    }
  };

  const handleArrangeBacklog = async () => {
    if (!plan) return;
    setCheckInMsg(null);
    try {
      const preview = await createRemedyPreview(plan.id);
      if (plan.id !== 'derived-latest') setActivePlanId(plan.id);
      setPendingAdjustment(preview);
      openAssistantWithContext({ type: 'free', hint: '查看补救预览' });
      setDialog(null);
      setCheckInMsg('已生成补救预览，确认前不会改正式计划');
    } catch (e) {
      setCheckInMsg(e instanceof ApiError ? e.message : '没有可安排的待补任务');
    }
  };

  const handleAddToday = async () => {
    if (addingToday) return;
    setAddingToday(true);
    setCheckInMsg(null);
    try {
      await addTodayTask(today);
      setCheckInMsg('已补上今天的任务');
      await reload();
    } catch (e) {
      setCheckInMsg(e instanceof ApiError ? e.message : '补任务失败，请稍后重试');
    } finally {
      setAddingToday(false);
    }
  };

  const handleCheckIn = async (values: CheckInFormValues) => {
    setCheckInMsg(null);
    try {
      await createCheckIn({
        checkDate: today,
        durationMinutes: values.durationMinutes,
        difficulty: values.difficulty,
        energy: values.energy,
        note: values.note || undefined,
      });
      setCheckInMsg('打卡成功，今日状态已刷新');
      await reload();
    } catch (e) {
      setCheckInMsg(e instanceof ApiError ? e.message : '打卡失败，请稍后重试');
    }
  };

  const pageRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: pageRef,
    offset: ['start start', 'end start'],
  });
  const backgroundColor = useTransform(
    scrollYProgress,
    [0, 1],
    ['rgba(234, 242, 236, 0)', 'rgba(209, 250, 229, 0.45)'],
  );
  const goalParallaxY = useTransform(scrollYProgress, [0, 1], [0, -20]);

  const weekCal = currentWeekCalendar();
  const insights = useMemo(
    () => buildLearningInsights(metrics, todayTasks),
    [metrics, todayTasks],
  );
  const selfNote = useMemo(
    () => buildSelfNote({ metrics, review, todayTasks }),
    [metrics, review, todayTasks],
  );
  const weekLabel = isoWeekLabel();

  const overview: PostcardsOverview = { ready: !loading, error, plan, metrics, tasks: todayTasks, review, insights, pendingMistakeCount, dueMistakeCount, unavailable };
  const handleAction = (action: OverviewAction) => {
    setCheckInMsg(null);
    if (action === 'start') { setDialog(null); setStarting(true); }
    else if (action === 'plan') { setDialog(null); openAssistantWithContext({ type: 'plan', hint: '制定学习规划' }); }
    else if (action === 'goal' || action === 'tasks' || action === 'checkin' || action === 'mastery') setDialog(action);
    else if (action === 'backlog') { setDialog('weekly'); void handleArrangeBacklog(); }
    else {
      setDialog(null);
      if (action === 'mistakes' && dueMistakeCount > 0) requestMistakeFilter('due');
      go(action === 'weekly' ? 'weekly' : action === 'mistakes' ? 'mistakes' : action === 'profile' ? 'profile' : 'roadmap');
    }
  };

  if (presentation === 'postcards') return <div id="learning-overview" ref={pageRef}>
    <StudyPilotPostcards overview={overview} onAction={handleAction} />
    {starting && <DailyStartDialog defaultMinutes={Math.min(plan?.dailyMinutes || 30, 30)} onClose={() => setStarting(false)} onConfirm={(prompt) => {
      setStarting(false);
      openAssistantWithContext({ type: 'free', hint: prompt });
      useAssistantStore.getState().queuePrompt(prompt);
    }} />}
    {dialog && <OverviewDetailsDialog key={dialog} mode={dialog} data={overview} message={checkInMsg} addingToday={addingToday} onClose={() => setDialog(null)} onAction={handleAction} onToggleTask={handleToggleTask} onAddToday={handleAddToday} onCheckIn={handleCheckIn} />}
  </div>;

  return (
    <motion.div ref={pageRef} style={{ backgroundColor }} className="rounded-[40px]">
      {error ? (
        <div role="alert" className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
          <button type="button" className="ml-3 underline" onClick={() => void reload()}>
            重试
          </button>
        </div>
      ) : null}
      {checkInMsg ? (
        <p className="mb-4 text-sm text-brandDark">{checkInMsg}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <StickyStack className="flex flex-col gap-6 lg:col-span-2">
          <motion.div style={{ y: goalParallaxY }}>
            <FadeIn delay={0.15} y={40}>
              {loading && !metrics ? (
                <section className="card p-8 text-sm text-gray-400">加载学习指标…</section>
              ) : plan ? (
                <GoalCard plan={plan} today={today} />
              ) : (
                <section className="card p-8">
                  <p className="text-sm text-gray-500">当前目标</p>
                  <h2 className="mt-2 font-display text-2xl font-bold text-brandDark">
                    尚未生成学习规划
                  </h2>
                  <p className="mt-2 text-sm text-gray-500">
                    在学习助手中提交学习内容和完成标准后，这里会显示目标与进度。
                  </p>
                  <button
                    type="button"
                    className="btn-pill mt-5 px-5 py-2 text-sm"
                    onClick={() =>
                      openAssistantWithContext({
                        type: 'plan',
                        hint: '制定学习规划',
                      })
                    }
                  >
                    去提交学习目标
                  </button>
                </section>
              )}
            </FadeIn>
          </motion.div>
          {metrics ? <MetricsRow metrics={metrics} /> : null}
          <WeekCalendar days={weekCal.days} todayIndex={weekCal.todayIndex} />
        </StickyStack>

        <div className="lg:col-span-1">
          <TodayTaskCard
            todayStatus={metrics?.todayStatus ?? '未反馈'}
            date={today}
            tasks={todayTasks}
            tasksReady={!loading}
            hasPlan={Boolean(plan)}
            addingToday={addingToday}
            onAddToday={() => void handleAddToday()}
            onToggleTask={(task) => void handleToggleTask(task)}
            onCheckIn={(v) => void handleCheckIn(v)}
            onStart={(mins) => {
              const nextTask = todayTasks.find((task) => task.status === 'pending');
              const prompt = nextTask
                ? `开始今天 ${mins} 分钟。先做：${nextTask.description}`
                : `开始今天 ${mins} 分钟学习`;
              openAssistantWithContext({ type: 'free', hint: prompt });
              useAssistantStore.getState().queuePrompt(prompt);
            }}
          />
        </div>
      </div>

      {/* 路线洞察：学习模式 + 知识掌握度 */}
      <section className="mt-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-2xl font-bold text-brandDark sm:text-3xl">
            你的路线，正在跟着你变化
          </h2>
          <div className="flex flex-wrap gap-3">
            {plan ? (
              <button
                type="button"
                onClick={() => void handleArrangeBacklog()}
                className="text-sm font-medium text-brandDark underline-offset-2 hover:underline"
              >
                安排未完成的任务
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => go('roadmap')}
              className="text-sm font-medium text-brandDark/70 transition hover:text-brandDark"
            >
              展开完整路线 →
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <FadeIn delay={0.05} y={24}>
            <LearningModeCard
              weekLabel={weekLabel}
              insights={insights}
              onOpenWeekly={() => go('weekly')}
            />
          </FadeIn>
          <FadeIn delay={0.1} y={24}>
            <MasteryOverviewCard
              avg={review?.masteryAvg ?? 0}
              items={review?.masteryDetail ?? []}
            />
          </FadeIn>
        </div>
      </section>

      {/* 错题队列 + 近期自述 */}
      <section className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <FadeIn delay={0.08} y={24}>
          <ReviewQueueCard
            pendingCount={pendingMistakeCount}
            dueCount={dueMistakeCount}
            featured={featuredMistake}
            onOpenMistakes={() => {
              if (dueMistakeCount > 0) requestMistakeFilter('due');
              go('mistakes');
            }}
          />
        </FadeIn>
        <FadeIn delay={0.12} y={24}>
          <SelfNoteCard
            headline={selfNote.headline}
            recentLabel={selfNote.recentLabel}
            nextStep={selfNote.nextStep}
          />
        </FadeIn>
      </section>
    </motion.div>
  );
}

export default OverviewPage;
