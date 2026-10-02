import { useCallback, useEffect, useState } from 'react';
import RoadmapHeader from '@/components/RoadmapHeader';
import PhaseList from '@/components/PhaseList';
import WeekTaskGroups from '@/components/WeekTaskGroups';
import type { DailyTask, Phase } from '@/mocks/types';
import { currentWeekDates, todayISO } from '@/lib/dates';
import {
  fetchDailyTasksForDates,
  fetchOverviewMetrics,
  setDailyTaskStatus,
} from '@/lib/studyApi';
import { fetchLatestPlan } from '@/lib/plansApi';
import { ApiError } from '@/lib/httpClient';
import { useAssistantStore } from '@/store';

/**
 * Roadmap：阶段来自 GET /api/plans/latest；本周任务来自每日 daily-tasks。
 */
function RoadmapPage() {
  const today = todayISO();
  const openAssistantWithContext = useAssistantStore((s) => s.openAssistantWithContext);

  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [hasPlan, setHasPlan] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(today);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const week = currentWeekDates();
      const [weekTasks, overview, latest] = await Promise.all([
        fetchDailyTasksForDates(week),
        fetchOverviewMetrics(today),
        fetchLatestPlan().catch(() => ({
          status: 'ok',
          empty: true,
          plan: null,
          phases: [],
        })),
      ]);
      setTasks(weekTasks);
      const planExists =
        Boolean(latest.plan) || overview.phaseProgress.total > 0;
      setHasPlan(planExists);
      setPhases(
        (latest.phases ?? []).map((p) => ({
          id: p.id,
          phaseIndex: p.phaseIndex,
          name: p.name,
          startDate: p.startDate,
          endDate: p.endDate,
          progressPercent: p.progressPercent,
          isCurrent: p.isCurrent,
          isCompleted: p.isCompleted,
        })),
      );
      setUpdatedAt(latest.plan?.updatedAt?.slice(0, 10) ?? today);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Roadmap 加载失败');
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleToggle = async (task: DailyTask) => {
    const next = task.status === 'done' ? 'pending' : 'done';
    setStatusMsg(null);
    try {
      const res = await setDailyTaskStatus(task.id, next);
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: res.task.status } : t)),
      );
      setStatusMsg(
        next === 'done' ? '已标记完成，阶段进度已更新' : '已改回待完成',
      );
      // 任务状态可能推动阶段进度，轻量刷新阶段列表
      const latest = await fetchLatestPlan().catch(() => null);
      if (latest?.phases) {
        setPhases(
          latest.phases.map((p) => ({
            id: p.id,
            phaseIndex: p.phaseIndex,
            name: p.name,
            startDate: p.startDate,
            endDate: p.endDate,
            progressPercent: p.progressPercent,
            isCurrent: p.isCurrent,
            isCompleted: p.isCompleted,
          })),
        );
      }
    } catch (e) {
      setStatusMsg(e instanceof ApiError ? e.message : '状态更新失败');
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <RoadmapHeader updatedAt={updatedAt} />

      {error ? (
        <div role="alert" className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
          <button type="button" className="ml-3 underline" onClick={() => void reload()}>
            重试
          </button>
        </div>
      ) : null}
      {statusMsg ? <p className="text-sm text-brandDark">{statusMsg}</p> : null}
      {loading ? <p className="text-sm text-gray-400">加载本周考研任务…</p> : null}

      {!loading && !hasPlan ? (
        <section className="card p-6">
          <p className="text-sm font-medium text-brandDark">还没有阶段路线图</p>
          <p className="mt-1 text-xs text-gray-500">
            生成规划后，这里会展示各复习阶段与本周每日任务。请先在助手中提交考研目标。
          </p>
          <button
            type="button"
            className="btn-pill mt-4 px-5 py-2 text-sm"
            onClick={() =>
              openAssistantWithContext({ type: 'plan', hint: '生成考研复习 Roadmap' })
            }
          >
            去生成规划
          </button>
        </section>
      ) : (
        <PhaseList phases={phases} />
      )}

      <WeekTaskGroups tasks={tasks} onToggleStatus={(t) => void handleToggle(t)} />
    </div>
  );
}

export default RoadmapPage;
