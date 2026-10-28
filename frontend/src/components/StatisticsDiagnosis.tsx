import { useEffect, useRef, useState } from 'react';
import { ArrowRight, FileText, Lightbulb } from 'lucide-react';
import { Pencil, X } from 'lucide';
import { MorphIcon } from 'morphicons/react';
import { AssistantMarkdown } from '@/lib/assistantMarkdown';
import { ApiError } from '@/lib/httpClient';
import { conversationApi } from '@/lib/conversationApi';
import {
  fetchDiagnosisHistory,
  fetchLatestDiagnosis,
  generateDiagnosis,
  type DiagnosisReport,
} from '@/lib/statisticsApi';
import './StatisticsDiagnosis.css';

type ReportView = 'latest' | 'history' | 'search';

export function filterDiagnosisReports(reports: DiagnosisReport[], query: string) {
  const term = query.trim().toLocaleLowerCase();
  return reports.filter((report) => {
    const date = new Date(report.generatedAt);
    const local = date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const isoDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
    return `${report.title ?? '学习诊断报告'} ${local} ${isoDay}`
      .toLocaleLowerCase()
      .includes(term);
  });
}

export async function renameDiagnosisReport(report: DiagnosisReport, input: string) {
  const title = input.trim();
  if (!title || title.length > 64) throw new Error('报告名字需为 1–64 个字符');
  await conversationApi.rename(report.id, title);
  return { ...report, title };
}

function DiagnosisReportRow({
  report,
  onSelect,
  onRename,
}: {
  report: DiagnosisReport;
  onSelect: (report: DiagnosisReport) => void;
  onRename: (report: DiagnosisReport) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(report.title ?? '学习诊断报告');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const renamed = await renameDiagnosisReport(report, title);
      onRename(renamed);
      setTitle(renamed.title ?? '学习诊断报告');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '改名失败，请重试');
    } finally {
      setSaving(false);
    }
  };
  return (
    <li className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onSelect(report)}
          className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 text-left text-sm hover:text-blue-600"
        >
          <span className="font-medium text-slate-800">{report.title ?? '学习诊断报告'}</span>
          <span className="text-xs text-slate-500">
            {new Date(report.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
            （北京时间）
          </span>
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`改名：${report.title ?? '学习诊断报告'}`}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
        >
          <MorphIcon icon={open ? X : Pencil} />
        </button>
      </div>
      {open ? (
        <form
          className="mt-3 flex flex-wrap items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="min-w-0 flex-1 text-xs text-slate-500">
            报告名字
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={64}
              disabled={saving}
              className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="mt-5 rounded-lg bg-blue-500 px-3 py-2 text-sm text-white disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存'}
          </button>
          {error ? (
            <p role="alert" className="w-full text-xs text-red-600">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </li>
  );
}

export function DiagnosisReportList({
  reports,
  onSelect,
  onRename,
}: {
  reports: DiagnosisReport[];
  onSelect: (report: DiagnosisReport) => void;
  onRename: (report: DiagnosisReport) => void;
}) {
  return reports.length ? (
    <ul className="mt-4 w-full space-y-2" aria-label="诊断报告列表">
      {reports.map((report) => (
        <DiagnosisReportRow
          key={report.id}
          report={report}
          onSelect={onSelect}
          onRename={onRename}
        />
      ))}
    </ul>
  ) : (
    <p role="status" className="mt-4 text-sm text-slate-500">
      暂无匹配的诊断报告
    </p>
  );
}

export function DiagnosisContent({ report }: { report: DiagnosisReport }) {
  const date = (value: string) =>
    new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const { evidence } = report;
  return (
    <article
      id="statistics-diagnosis-report"
      className="mt-6 w-full rounded-2xl border border-blue-100 bg-white p-6 text-left shadow-sm"
      aria-label="诊断报告"
    >
      <h3 className="text-xl font-semibold text-slate-800">诊断报告</h3>
      {report.title ? <p className="mt-2 font-medium text-slate-700">{report.title}</p> : null}
      <p className="mt-2 text-xs text-slate-500">
        生成时间：{date(report.generatedAt)}（北京时间）
      </p>
      <p className="mt-1 text-xs text-slate-500">
        数据范围：{date(evidence.rangeStart)} 至 {date(evidence.rangeEnd)}（北京时间）
      </p>
      <p className="mt-2 text-sm text-slate-600">
        全时段作答记录 {evidence.totalAnswered} 条：正确 {evidence.distribution.correct}、部分正确{' '}
        {evidence.distribution.partial}、错误 {evidence.distribution.wrong}；分析最近{' '}
        {evidence.sampleCount} 条证据。
      </p>
      <p className="mt-2 text-xs text-slate-500">
        这是生成时的数据快照。AI
        建议供参考，不会自动调整学习计划；作答记录包含练习与讲解反馈，不等同于去重题数。
      </p>
      <div className="mt-5 text-sm leading-7 text-slate-700">
        <AssistantMarkdown text={report.content} />
      </div>
    </article>
  );
}

export default function StatisticsDiagnosis() {
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [latest, setLatest] = useState<DiagnosisReport | null>(null);
  const [reports, setReports] = useState<DiagnosisReport[]>([]);
  const [view, setView] = useState<ReportView>('latest');
  const [query, setQuery] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const currentView = useRef<ReportView>('latest');
  const historyVersion = useRef(0);
  const [shown, setShown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const requestVersion = useRef(0);

  const load = async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchLatestDiagnosis();
      if (alive.current && version === requestVersion.current) {
        setLatest(result.report);
        if (currentView.current === 'latest') setReport(result.report);
      }
    } catch (err) {
      if (alive.current && version === requestVersion.current)
        setError(err instanceof ApiError ? err.message : '诊断报告加载失败，请重试');
    } finally {
      if (alive.current && version === requestVersion.current) setLoading(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      requestVersion.current += 1;
      historyVersion.current += 1;
    };
  }, []);

  const changeView = async (next: ReportView) => {
    currentView.current = next;
    setView(next);
    setShown(next === 'latest');
    setReport(next === 'latest' ? latest : null);
    const version = ++historyVersion.current;
    setHistoryError(null);
    setHistoryLoading(false);
    if (next === 'latest') return;
    setHistoryLoading(true);
    try {
      const result = await fetchDiagnosisHistory();
      if (alive.current && version === historyVersion.current) setReports(result.reports);
    } catch (err) {
      if (alive.current && version === historyVersion.current)
        setHistoryError(err instanceof ApiError ? err.message : '历史报告加载失败，请重试');
    } finally {
      if (alive.current && version === historyVersion.current) setHistoryLoading(false);
    }
  };

  const generate = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    requestVersion.current += 1;
    setBusy(true);
    setError(null);
    try {
      const result = await generateDiagnosis();
      if (alive.current) {
        setLatest(result.report);
        setReport(result.report);
        currentView.current = 'latest';
        setView('latest');
        historyVersion.current += 1;
        setHistoryLoading(false);
        setShown(true);
      }
    } catch (err) {
      if (alive.current)
        setError(err instanceof ApiError ? err.message : '诊断报告生成失败，请重试');
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return (
    <section className="mt-8 flex flex-col items-center" aria-label="学习诊断分析">
      <div className="group flex w-full max-w-sm flex-col items-center squircle-card border-2 border-dashed border-slate-300 bg-white p-8 text-center shadow-sm transition-all duration-300 ease-in-out hover:border-solid hover:border-blue-400 hover:shadow-[0_8px_28px_rgba(59,130,246,0.22)]">
        <div className="relative mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-blue-500 shadow-[0_8px_20px_rgba(59,130,246,0.35)] transition-all duration-300 ease-out group-hover:rotate-12 group-hover:rounded-3xl">
          <div className="absolute top-2 left-2 h-0.5 w-2 rotate-45 rounded-full bg-white" />
          <div className="absolute top-2 right-2 h-0.5 w-2 -rotate-45 rounded-full bg-white" />
          <div className="absolute bottom-2 left-2 h-0.5 w-2 -rotate-45 rounded-full bg-white" />
          <div className="absolute bottom-2 right-2 h-0.5 w-2 rotate-45 rounded-full bg-white" />
          <Lightbulb className="h-10 w-10 text-white" aria-hidden="true" />
        </div>
        <h3 className="mb-2 text-xl font-semibold text-slate-800">学习诊断分析</h3>
        <p className="mb-6 text-slate-600">基于你的刷题数据，AI 将为你生成个性化学习建议</p>
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => void generate()}
          className="flex items-center gap-2 rounded-lg bg-blue-500 px-6 py-3 text-white shadow-md hover:bg-blue-600 disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? '正在生成诊断报告…' : latest ? '重新生成诊断报告' : '生成诊断报告'}
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </button>
        {loading ? (
          <p role="status" className="mt-3 text-sm text-slate-500">
            加载诊断报告…
          </p>
        ) : null}
        {report ? (
          <button
            type="button"
            aria-expanded={shown}
            aria-controls="statistics-diagnosis-report"
            onClick={() => setShown(!shown)}
            className="mt-4 flex items-center gap-2 text-sm font-medium text-blue-600"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            {shown ? '收起诊断报告' : '诊断报告'}
          </button>
        ) : null}
        {error ? (
          <div role="alert" className="mt-4 text-sm text-red-600">
            {error}
            <button
              type="button"
              disabled={loading || busy}
              onClick={() => void load()}
              className="ml-2 underline"
            >
              重新加载
            </button>
          </div>
        ) : null}
      </div>
      <div className="mt-6 max-w-full overflow-x-auto pb-2" role="group" aria-label="诊断报告视图">
        <div className="glass-radio-group">
          <input
            type="radio"
            name="plan"
            id="glass-silver"
            checked={view === 'latest'}
            onChange={() => void changeView('latest')}
          />
          <label htmlFor="glass-silver">最新报告</label>
          <input
            type="radio"
            name="plan"
            id="glass-gold"
            checked={view === 'history'}
            onChange={() => {}}
            onClick={() => {
              if (currentView.current === 'history') setHistoryExpanded((expanded) => !expanded);
              else {
                setHistoryExpanded(true);
                void changeView('history');
              }
            }}
          />
          <label htmlFor="glass-gold">历史报告</label>
          <input
            type="radio"
            name="plan"
            id="glass-platinum"
            checked={view === 'search'}
            onChange={() => void changeView('search')}
          />
          <label htmlFor="glass-platinum">搜索报告</label>
          <div className="glass-glider"></div>
        </div>
      </div>
      {view === 'search' ? (
        <label className="mt-4 w-full text-sm text-slate-600">
          报告名字或日期（北京时间）
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="例如：学习诊断报告、2026-10-28"
            className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-800"
          />
        </label>
      ) : null}
      {view !== 'latest' && (view !== 'history' || historyExpanded) ? (
        historyLoading ? (
          <p role="status" className="mt-4 text-sm text-slate-500">
            加载历史报告…
          </p>
        ) : historyError ? (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {historyError}
            <button type="button" className="ml-2 underline" onClick={() => void changeView(view)}>
              重试
            </button>
          </p>
        ) : (
          <DiagnosisReportList
            reports={view === 'search' ? filterDiagnosisReports(reports, query) : reports}
            onSelect={(selected) => {
              setReport(selected);
              setShown(true);
            }}
            onRename={(renamed) => {
              setReports((items) => items.map((item) => (item.id === renamed.id ? renamed : item)));
              setReport((selected) => (selected?.id === renamed.id ? renamed : selected));
              setLatest((selected) => (selected?.id === renamed.id ? renamed : selected));
            }}
          />
        )
      ) : view === 'latest' && !loading && !latest ? (
        <p className="mt-4 text-sm text-slate-500">暂无诊断报告，请先生成</p>
      ) : null}
      {shown && report && (view !== 'history' || historyExpanded) ? (
        <DiagnosisContent report={report} />
      ) : null}
    </section>
  );
}
