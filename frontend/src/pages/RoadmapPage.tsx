import { useCallback, useEffect, useState } from 'react';
import RoadmapHeader from '@/components/RoadmapHeader';
import PhaseList, { type PhaseEdit } from '@/components/PhaseList';
import WeekTaskGroups from '@/components/WeekTaskGroups';
import type { DailyTask, Phase } from '@/mocks/types';
import { currentWeekDates, todayISO } from '@/lib/dates';
import {
  fetchDailyTasksForDates,
  fetchOverviewMetrics,
  fetchPhaseTasks,
  addTodayTask,
  setDailyTaskStatus,
} from '@/lib/studyApi';
import { fetchLatestPlan, patchPhase } from '@/lib/plansApi';
import { ApiError } from '@/lib/httpClient';
import { useAssistantStore } from '@/store';
import { usePlanSessionStore } from '@/store/planSessionStore';

/**
 * Roadmap：阶段来自 GET /api/plans/latest；本周任务来自每日 daily-tasks。
 */
function RoadmapPage() {
  const today = todayISO();
  const openAssistantWithContext = useAssistantStore((s) => s.openAssistantWithContext);
  const lastPlanId = usePlanSessionStore((s) => s.lastPlanId);

  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [hasPlan, setHasPlan] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(today);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [addingToday, setAddingToday] = useState(false);
  const [expandedPhaseId, setExpandedPhaseId] = useState<string | null>(null);
  const [phaseTasks, setPhaseTasks] = useState<DailyTask[]>([]);
  const [phaseTasksLoading, setPhaseTasksLoading] = useState(false);

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
  }, [reload, lastPlanId]);

  const handleAddToday = async () => {
    if (addingToday) return;
    setAddingToday(true);
    setStatusMsg(null);
    try {
      await addTodayTask(today);
      setStatusMsg('已补上今天的任务');
      await reload();
    } catch (e) {
      setStatusMsg(e instanceof ApiError ? e.message : '补任务失败，请稍后重试');
    } finally {
      setAddingToday(false);
    }
  };

  const handleSavePhase = async (phaseId: string, edit: PhaseEdit) => {
    setStatusMsg(null);
    try {
      const res = await patchPhase(phaseId, edit);
      setPhases((prev) =>
        prev.map((phase) =>
          phase.id === phaseId
            ? {
                ...phase,
                name: res.phase.name,
                startDate: res.phase.startDate,
                endDate: res.phase.endDate,
              }
            : phase,
        ),
      );
      setStatusMsg('已更新这一阶段，其他阶段没有改动');
    } catch (e) {
      setStatusMsg(e instanceof ApiError ? e.message : '阶段调整失败');
      throw e;
    }
  };

  const handleTogglePhase = async (phaseId: string) => {
    if (expandedPhaseId === phaseId) {
      setExpandedPhaseId(null);
      return;
    }
    setExpandedPhaseId(phaseId);
    setPhaseTasks([]);
    setPhaseTasksLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetchPhaseTasks(phaseId);
      setPhaseTasks(res.tasks);
    } catch (e) {
      setExpandedPhaseId(null);
      setStatusMsg(e instanceof ApiError ? e.message : '这个阶段的任务加载失败');
    } finally {
      setPhaseTasksLoading(false);
    }
  };

  const handleToggle = async (task: DailyTask) => {
    const next = task.status === 'done' ? 'pending' : 'done';
    setStatusMsg(null);
    try {
      const res = await setDailyTaskStatus(task.id, next);
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: res.task.status } : t)),
      );
      setPhaseTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: res.task.status } : t)),
      );
      setStatusMsg(
        next === 'done' ? '已标记完成；阶段进度与当前阶段会跟着更新' : '已改回待完成',
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
        <PhaseList
          phases={phases}
          onSavePhase={handleSavePhase}
          expandedPhaseId={expandedPhaseId}
          phaseTasks={phaseTasks}
          phaseTasksLoading={phaseTasksLoading}
          onTogglePhase={(id) => void handleTogglePhase(id)}
          onToggleTask={(task) => void handleToggle(task)}
        />
      )}

      {!loading && hasPlan && !tasks.some((task) => task.taskDate === today) ? (
        <button
          type="button"
          disabled={addingToday}
          onClick={() => void handleAddToday()}
          className="btn-pill self-start px-5 py-2 text-sm disabled:opacity-60"
        >
          {addingToday ? '正在补上…' : '补上今天的任务'}
        </button>
      ) : null}

      <WeekTaskGroups tasks={tasks} onToggleStatus={(t) => void handleToggle(t)} />
    </div>
  );
}

export default RoadmapPage;
