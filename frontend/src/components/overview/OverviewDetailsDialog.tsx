import { useState } from 'react';
import { weakestEvidence, type PostcardsOverview, type OverviewAction } from '@/lib/postcardsOverview';
import type { DailyTask } from '@/mocks/types';
import type { CheckInFormValues } from '@/components/CheckInForm';
import OverviewDialog from './OverviewDialog';

export default function OverviewDetailsDialog({ mode, data, message, addingToday, onClose, onRetry, highlightedPhase, onAction, onToggleTask, onAddToday, onCheckIn }: {
  mode: 'goal' | 'tasks' | 'checkin' | 'mastery' | 'weekly'; data: PostcardsOverview; message: string | null; addingToday: boolean;
  onClose: () => void; onRetry?: () => void; highlightedPhase?: string; onAction: (action: OverviewAction) => void;
  onToggleTask: (task: DailyTask) => Promise<void>; onAddToday: () => Promise<void>; onCheckIn: (values: CheckInFormValues) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState<number | ''>('');
  const [difficulty, setDifficulty] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [note, setNote] = useState('');
  const titles = { goal: '我的学习目标', tasks: '查看今日任务', checkin: '今日打卡', mastery: '知识掌握详情', weekly: '学习回顾与复盘' };
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); try { await action(); } finally { setBusy(false); } };
  return <OverviewDialog title={titles[mode]} onClose={onClose}>
    {message && <p role="status" className="spp-message">{message}</p>}
    {data.error && <p role="alert">{data.error}</p>}{data.unavailable.length > 0 && <p role="alert">部分记录暂未读取。<button type="button" onClick={onRetry}>重新读取</button></p>}
    {mode === 'goal' && <>{!data.ready ? <p role="status">正在读取学习目标…</p> : data.unavailable.includes('plan') ? <p>学习目标读取失败，请重试。</p> : data.plan ? <><h3>{data.plan.goalName}</h3><p>{data.plan.currentLevel || data.plan.subtitle}</p><p>目标期限：{data.plan.startDate} — {data.plan.goalDate}</p><p>完成标准：{data.plan.completionCriterion || '尚未设置'}</p></> : <p>尚未生成学习规划，先提交学习内容和完成标准。</p>}<button className="spp-button spp-button-lime" type="button" disabled={!data.ready || data.unavailable.includes('plan')} onClick={() => onAction(data.plan ? 'roadmap' : 'plan')}>{data.plan ? '查看完整路线' : '提交学习目标'}</button><button className="spp-button" type="button" onClick={() => onAction('profile')}>个人中心</button></>}
    {mode === 'tasks' && <>
      <p className="spp-muted">{data.metrics?.todayStatus ?? '未反馈'} · 勾选只更新这项任务的完成状态，打卡请单独填写。</p>
      {!data.ready ? <p role="status">正在读取今日任务…</p> : data.unavailable.includes('tasks') ? <p role="alert">今日任务暂时无法读取，请重新读取后再操作。</p> : data.tasks.filter((task) => task.status !== 'carried').length ? data.tasks.filter((task) => task.status !== 'carried').map((task) => <label className="spp-task-choice" key={task.id}><input type="checkbox" checked={task.status === 'done'} disabled={busy || !data.ready} onChange={() => void run(() => onToggleTask(task))} /><span>{task.description}</span></label>) : <p>今天还没有安排任务。可以先开始一项轻量练习，或补上当前阶段的任务。</p>}
      <div className="spp-dialog-actions"><button className="spp-button spp-button-lime" type="button" onClick={() => onAction('start')}>先确认今天的量</button><button className="spp-button" type="button" onClick={() => onAction('checkin')}>填写今日打卡</button>{data.plan && !data.tasks.length && <button className="spp-button" type="button" disabled={busy || addingToday || data.unavailable.includes('tasks')} onClick={() => void run(onAddToday)}>{addingToday ? '正在补上…' : '补上今天的任务'}</button>}</div>
    </>}
    {mode === 'checkin' && <form className="spp-feedback-form" onSubmit={(event) => { event.preventDefault(); void run(() => onCheckIn({ durationMinutes: Number(minutes), difficulty, energy, note })); }}>
      <p className="spp-muted">填写实际完成的学习情况，确认的可用时间不会自动算成学习记录。</p>
      <label>实际学习分钟<input required type="number" min="1" max="1440" value={minutes} onChange={(event) => setMinutes(event.target.value === '' ? '' : Number(event.target.value))} /></label>
      <label>主观难度<select value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>精力状态<select value={energy} onChange={(event) => setEnergy(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>备注<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="今天的感受或遇到的问题…" /></label>
      <button className="spp-button spp-button-lime" type="submit" disabled={busy}>{busy ? '正在保存…' : '完成打卡'}</button>
    </form>}
    {mode === 'mastery' && <>
      <p className="spp-muted">以下为最近周报的练习证据得分，不代表今天的实时状态。正确记 100、部分掌握记 50、错误记 0。</p>
      {!data.ready ? <p role="status">正在读取最近评估…</p> : data.unavailable.includes('review') ? <p>最近评估读取失败，暂时无法判断。</p> : data.review ? <><p>统计周期：{data.review.weekStart} — {data.review.weekEnd}</p><ul className="spp-detail-list">{[...data.review.masteryDetail].sort((a, b) => Number(b.phaseId === highlightedPhase) - Number(a.phaseId === highlightedPhase)).map((item) => <li key={item.phaseId ?? item.subject}><strong>{item.subject}{item === weakestEvidence(data.review) || (highlightedPhase && item.phaseId === highlightedPhase) ? ' · 建议回看' : ''}</strong><br />{item.percent === null ? '暂无证据' : `${item.percent}%`} · {item.evidenceCount ?? 0} 条证据{(item.evidenceCount ?? 0) > 0 && (item.evidenceCount ?? 0) < 5 ? ' · 样本较少，请结合原题判断' : ''}</li>)}</ul>{!data.review.masteryDetail.length && <p>本周期暂无掌握度证据。</p>}</> : <p>还没有学习周报。留下练习与反馈证据后，再查看掌握情况。</p>}
      <div className="spp-dialog-actions"><button className="spp-button spp-button-lime" type="button" onClick={() => onAction('practice')}>前往今日练习</button><button className="spp-button" type="button" onClick={() => onAction('weekly')}>查看完整学习周报</button></div>
    </>}
    {mode === 'weekly' && <><p>{data.review ? `${data.review.weekStart} — ${data.review.weekEnd}：实际打卡 ${data.review.totalMinutes} 分钟，任务完成率 ${data.review.completionRate}%。` : '还没有学习周报。可以到数据统计生成复盘。'}</p><ul className="spp-detail-list">{data.insights.map((item) => <li key={item.index}><strong>{item.title}</strong><p>{item.body}</p><small>{item.evidence}</small></li>)}</ul><button className="spp-button spp-button-lime" type="button" onClick={() => onAction('weekly')}>打开学习周报</button><button className="spp-button" type="button" onClick={() => onAction('backlog')}>安排未完成任务</button></>}
  </OverviewDialog>;
}
