import { useEffect, useState } from 'react';
import type { DailyTask } from '@/mocks/types';
import { fetchPhaseTasks } from '@/lib/studyApi';
import { fetchLatestPlan } from '@/lib/plansApi';
import { todayISO } from '@/lib/dates';
import { buildDailyStartPrompt, dailyStartChoices, dailyStartSummary, MICRO_TASKS } from '@/lib/dailyStart';
import OverviewDialog from './OverviewDialog';

export default function DailyStartDialog({ onClose, onConfirm, defaultMinutes = 30 }: { onClose: () => void; onConfirm: (prompt: string) => void; defaultMinutes?: number }) {
  const [minutes, setMinutes] = useState(Math.max(5, Math.min(240, defaultMinutes || 30)));
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [microTasks, setMicroTasks] = useState<string[]>([MICRO_TASKS[0]]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void fetchLatestPlan().then(async (plan) => {
      const results = await Promise.all(plan.phases.map((phase) => fetchPhaseTasks(phase.id)));
      return dailyStartChoices(results.flatMap((result) => result.tasks), todayISO());
    }).then((pending) => {
      if (!active) return;
      setTasks(pending);
      setSelected(pending[0] ? [pending[0].id] : []);
    }).catch(() => { if (active) setError('学习线路任务读取失败，请重试后再确认。'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  const count = tasks.length ? selected.length : microTasks.length;
  return <OverviewDialog title="今天，先做刚刚好的量" onClose={onClose} className="spp-daily-start-dialog">
    <p className="spp-muted">先看看今天的时间和状态。少做一点也可以，完成后再决定要不要继续。</p>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (loading || error || submitting) return;
      try {
        const prompt = buildDailyStartPrompt(minutes, tasks, selected, tasks.length ? undefined : microTasks);
        setSubmitting(true);
        onConfirm(prompt);
      } catch (reason) { setError(reason instanceof Error ? reason.message : '请检查本次任务量'); }
    }}>
      <fieldset><legend>今天能留多少时间？</legend><div className="spp-time-options">{[15, 30, 45, 60, 75, 90].map((value) => <button key={value} type="button" aria-pressed={minutes === value} onClick={() => setMinutes(value)}>{value} 分钟</button>)}</div><label className="spp-custom-time">自定分钟<input type="number" min="5" max="240" step="1" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} required /></label></fieldset>
      <section className="spp-daily-task-fieldset" aria-labelledby="daily-task-heading"><h3 id="daily-task-heading">这一次，选几项就好</h3>
        {loading ? <p role="status">正在读取学习线路任务…</p> : <>
          <p className="spp-muted">{tasks.length ? '来自学习线路，今日任务优先。可选一项或多项，列表内滚动查看更多。' : '学习线路暂无待完成任务。可自选轻量练习，原有任务记录不变。'}</p>
          <div className="spp-daily-task-list" role="region" aria-label="本次学习任务，可滚动多选" tabIndex={0} data-lenis-prevent>
            {tasks.length ? tasks.map((task) => <label key={task.id} className="spp-task-choice" title={task.description}><input type="checkbox" disabled={Boolean(error)} checked={selected.includes(task.id)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, task.id] : ids.filter((id) => id !== task.id))} /><span className="spp-daily-task-text"><span className="spp-daily-task-summary">{dailyStartSummary(task.description)}</span><small>原计划 {task.taskDate}{task.taskDate === todayISO() ? ' · 今日' : ''}</small></span></label>) : MICRO_TASKS.map((task) => <label key={task} className="spp-task-choice"><input type="checkbox" disabled={Boolean(error)} checked={microTasks.includes(task)} onChange={(event) => setMicroTasks((items) => event.target.checked ? [...items, task] : items.filter((item) => item !== task))} /><span className="spp-daily-task-summary">{task}</span></label>)}
          </div>
        </>}
      </section>
      {error && <p role="alert">{error} <button type="button" onClick={() => setAttempt((value) => value + 1)}>重试</button></p>}
      <p className="spp-muted">本次上限：{minutes || '—'} 分钟 · {count} 项。这里只确认本次学习范围，调整原规划仍需另行确认。</p>
      <div className="spp-dialog-actions"><button className="spp-button spp-button-lime" type="submit" disabled={loading || Boolean(error) || submitting || !count}>{submitting ? '正在开始…' : '就按这个量开始'}</button><button className="spp-button" type="button" onClick={onClose}>再想一下</button></div>
    </form>
  </OverviewDialog>;
}
