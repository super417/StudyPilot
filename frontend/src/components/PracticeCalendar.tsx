import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchPracticeDay, type PracticeDayDetail, type StarDayItem } from '@/lib/statisticsApi';
import { calendarToday, practiceCalendarDays, practiceDayLabel } from '@/lib/practiceCalendar';
import './PracticeCalendar.css';

const RESULT_LABELS = { correct: '正确', partial: '部分掌握', wrong: '错误' };

function PracticeDayDialog({ date, onClose, onOpenMistakes }: { date: string; onClose: () => void; onOpenMistakes?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<PracticeDayDetail | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    const dialog = ref.current;
    dialog?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setDetail(null);
    setError(false);
    void fetchPracticeDay(date, controller.signal).then((result) => {
      if (active && result.date === date) setDetail(result);
      else if (active) setError(true);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; controller.abort(); };
  }, [date, attempt]);
  return createPortal(<dialog ref={ref} className="practice-day-dialog" aria-labelledby="practice-day-dialog-heading" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="practice-day-dialog-content">
      <header><div><p>当天练习证据</p><h2 id="practice-day-dialog-heading">{date}</h2></div><button type="button" aria-label="关闭练习详情" onClick={onClose}>×</button></header>
      {error ? <div role="alert"><p>当天记录读取失败，尚不能判断作答数量或得分。</p><button className="practice-day-action" type="button" onClick={() => setAttempt((value) => value + 1)}>重试</button></div> : !detail ? <p role="status">正在读取当天记录…</p> : <>
        <div className="practice-day-summary"><div><strong>{detail.answered}</strong><span>条练习证据</span></div><div><strong>{detail.score === null ? '—' : detail.score}</strong><span>{detail.score === null ? '暂无得分' : '练习证据得分 / 100'}</span></div></div>
        <dl className="practice-day-distribution">{(['correct', 'partial', 'wrong'] as const).map((result) => <div key={result}><dt>{RESULT_LABELS[result]}</dt><dd>{detail.distribution[result]} 条</dd></div>)}</dl>
        <p className="practice-day-note">统计范围：北京时间 {date} 00:00 至次日 00:00（不含）。得分按正确 100、部分掌握 50、错误 0 折算，仅反映已记录的练习证据，不等同于正确率或整体能力。</p>
        {!detail.answered ? <p className="practice-day-empty">这天暂无练习证据。休息和线下学习不会被记为未掌握。</p> : <>
          {detail.answered < 5 && <p className="practice-day-note">样本较少，请结合原题回看。</p>}
          <h3>证据明细</h3>
          {detail.truncated && <p className="practice-day-note">共 {detail.total} 条，展示最近 {detail.evidence.length} 条；上方统计包含当天全部证据。</p>}
          <ul className="practice-day-evidence">{detail.evidence.map((item) => <li key={item.id}><div><strong>{item.phaseName || '未关联阶段'}</strong><span>{RESULT_LABELS[item.result]}</span></div>{item.gradeReason && <p>{item.gradeReason}</p>}{item.errorTag && <small>错因标签：{item.errorTag}</small>}</li>)}</ul>
        </>}
      </>}
      {onOpenMistakes && <footer><button className="practice-day-action" type="button" onClick={() => { onClose(); onOpenMistakes(); }}>打开习题本 ↗</button><p className="practice-day-note">此入口查看已有题目，不按所选日期筛选。</p></footer>}
    </div>
  </dialog>, document.body);
}

export default function PracticeCalendar({ items, onOpenMistakes, today = calendarToday() }: { items: StarDayItem[]; onOpenMistakes?: () => void; today?: string }) {
  const days = useMemo(() => practiceCalendarDays(items, today), [items, today]);
  const recorded = days.filter((day): day is StarDayItem => day !== null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const count = recorded.reduce((sum, day) => sum + day.answered, 0);
  const activeDays = recorded.filter((day) => day.answered > 0).length;
  return <section className="practice-calendar" aria-label="近 30 日练习日历">
    <div className="practice-calendar-heading"><div><p className="practice-calendar-range">{recorded[0]?.date} — {recorded[recorded.length - 1]?.date}</p><p><strong>{activeDays}</strong> 个练习日 · <strong>{count}</strong> 条证据</p></div><span className="practice-calendar-mark" aria-hidden="true">✦</span></div>
    <div className="practice-calendar-grid" role="group" aria-label="按周一至周日排列，点击日期打开当天得分详情">
      {['一', '二', '三', '四', '五', '六', '日'].map((weekday) => <span className="practice-calendar-weekday" key={weekday}>{weekday}</span>)}
      {days.map((day, index) => day ? <button key={day.date} type="button" className={`practice-calendar-day practice-calendar-day-${day.answered ? day.star : 'none'}`} aria-label={`${practiceDayLabel(day)}${day.date === today ? '，今天' : ''}`} aria-haspopup="dialog" aria-expanded={day.date === selectedDate} aria-current={day.date === today ? 'date' : undefined} onClick={() => setSelectedDate(day.date)}>
        <span className="practice-calendar-date">{day.date.slice(8) === '01' || day.date === recorded[0].date ? `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8))}` : Number(day.date.slice(8))}</span>
        <span className="practice-calendar-dot" aria-hidden="true">{day.answered ? '✦' : '○'}</span>
        <small>{day.answered ? `${day.accuracy === null ? '—' : day.accuracy}分·${day.answered}条` : '无记录'}</small>
      </button> : <span key={`spacer-${index}`} aria-hidden="true" />)}
    </div>
    <p className="practice-calendar-legend"><span>○ 无记录</span><span>✦ 有练习证据</span><span>点击日期看得分</span></p>
    {selectedDate && <PracticeDayDialog key={selectedDate} date={selectedDate} onClose={() => setSelectedDate(null)} onOpenMistakes={onOpenMistakes} />}
  </section>;
}
