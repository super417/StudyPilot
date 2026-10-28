import { useState } from 'react';
import type { PostcardsOverview, OverviewAction } from '@/lib/postcardsOverview';
import type { DailyTask } from '@/mocks/types';
import type { CheckInFormValues } from '@/components/CheckInForm';
import OverviewDialog from './OverviewDialog';

export default function OverviewDetailsDialog({ mode, data, message, addingToday, onClose, onAction, onToggleTask, onAddToday, onCheckIn }: {
  mode: 'goal' | 'tasks' | 'checkin' | 'mastery' | 'weekly'; data: PostcardsOverview; message: string | null; addingToday: boolean;
  onClose: () => void; onAction: (action: OverviewAction) => void;
  onToggleTask: (task: DailyTask) => Promise<void>; onAddToday: () => Promise<void>; onCheckIn: (values: CheckInFormValues) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState(30);
  const [difficulty, setDifficulty] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [note, setNote] = useState('');
  const titles = { goal: '我的学习目标', tasks: '查看今日任务', checkin: '今日打卡', mastery: '知识掌握详情', weekly: '学习回顾与复盘' };
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); try { await action(); } finally { setBusy(false); } };
  return <OverviewDialog title={titles[mode]} onClose={onClose}>
    {message && <p role="status" className="spp-message">{message}</p>}
    {data.error && <p role="alert">{data.error}</p>}
    {mode === 'goal' && <>{data.plan ? <><h3>{data.plan.goalName}</h3><p>{data.plan.currentLevel || data.plan.subtitle}</p><p>目标期限：{data.plan.startDate} — {data.plan.goalDate}</p><p>完成标准：{data.plan.completionCriterion || '尚未设置'}</p></> : <p>尚未生成学习规划，先提交学习内容和完成标准。</p>}<button className="spp-button spp-button-lime" type="button" onClick={() => onAction(data.plan ? 'roadmap' : 'plan')}>{data.plan ? '查看完整路线' : '提交学习目标'}</button><button className="spp-button" type="button" onClick={() => onAction('profile')}>个人中心</button></>}
    {mode === 'tasks' && <>
      <p className="spp-muted">{data.metrics?.todayStatus ?? '未反馈'} · 勾选只更新这项任务的完成状态，打卡请单独填写。</p>
      {data.unavailable.includes('tasks') ? <p role="alert">今日任务暂时无法读取，请关闭后重试。</p> : data.tasks.length ? data.tasks.map((task) => <label className="spp-task-choice" key={task.id}><input type="checkbox" checked={task.status === 'done'} disabled={busy} onChange={() => void run(() => onToggleTask(task))} /><span>{task.description}</span></label>) : <p>今天还没有安排任务。可以先开始一项轻量练习，或补上当前阶段的任务。</p>}
      <div className="spp-dialog-actions"><button className="spp-button spp-button-lime" type="button" onClick={() => onAction('start')}>先确认今天的量</button><button className="spp-button" type="button" onClick={() => onAction('checkin')}>填写今日打卡</button>{data.plan && !data.tasks.length && <button className="spp-button" type="button" disabled={busy || addingToday || data.unavailable.includes('tasks')} onClick={() => void run(onAddToday)}>{addingToday ? '正在补上…' : '补上今天的任务'}</button>}</div>
    </>}
    {mode === 'checkin' && <form className="spp-feedback-form" onSubmit={(event) => { event.preventDefault(); void run(() => onCheckIn({ durationMinutes: minutes, difficulty, energy, note })); }}>
      <p className="spp-muted">填写实际完成的学习情况，确认的可用时间不会自动算成学习记录。</p>
      <label>实际学习分钟<input required type="number" min="1" max="1440" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label>
      <label>主观难度<select value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>精力状态<select value={energy} onChange={(event) => setEnergy(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>备注<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="今天的感受或遇到的问题…" /></label>
      <button className="spp-button spp-button-lime" type="submit" disabled={busy}>{busy ? '正在保存…' : '完成打卡'}</button>
    </form>}
    {mode === 'mastery' && <>
      <p className="spp-muted">以下为最近周报的掌握度证据，不是目标期限进度。</p>
      {data.review ? <><p>统计周期：{data.review.weekStart} — {data.review.weekEnd}</p><ul className="spp-detail-list">{data.review.masteryDetail.map((item) => <li key={item.phaseId ?? item.subject}><strong>{item.subject}</strong><br />{item.percent === null ? '暂无证据' : `${item.percent}%`} · {item.evidenceCount ?? 0} 条证据</li>)}</ul>{!data.review.masteryDetail.length && <p>本周期暂无掌握度证据。</p>}</> : <p>还没有学习周报。留下练习与反馈证据后，再查看掌握情况。</p>}
      <button className="spp-button spp-button-lime" type="button" onClick={() => onAction('weekly')}>查看完整学习周报</button>
    </>}
    {mode === 'weekly' && <><p>{data.review ? `${data.review.weekStart} — ${data.review.weekEnd}：实际打卡 ${data.review.totalMinutes} 分钟，任务完成率 ${data.review.completionRate}%。` : '还没有学习周报。可以到数据统计生成复盘。'}</p><ul className="spp-detail-list">{data.insights.map((item) => <li key={item.index}><strong>{item.title}</strong><p>{item.body}</p><small>{item.evidence}</small></li>)}</ul><button className="spp-button spp-button-lime" type="button" onClick={() => onAction('weekly')}>打开学习周报</button><button className="spp-button" type="button" onClick={() => onAction('backlog')}>安排未完成任务</button></>}
  </OverviewDialog>;
}
