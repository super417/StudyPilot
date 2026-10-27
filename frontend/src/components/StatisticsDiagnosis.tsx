import { useEffect, useRef, useState } from 'react';
import { ArrowRight, FileText, Lightbulb } from 'lucide-react';
import { AssistantMarkdown } from '@/lib/assistantMarkdown';
import { ApiError } from '@/lib/httpClient';
import { fetchLatestDiagnosis, generateDiagnosis, type DiagnosisReport } from '@/lib/statisticsApi';

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
      if (alive.current && version === requestVersion.current) setReport(result.report);
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
    };
  }, []);

  const generate = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    requestVersion.current += 1;
    setBusy(true);
    setError(null);
    try {
      const result = await generateDiagnosis();
      if (alive.current) {
        setReport(result.report);
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
          {busy ? '正在生成诊断报告…' : report ? '重新生成诊断报告' : '生成诊断报告'}
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
      {shown && report ? <DiagnosisContent report={report} /> : null}
    </section>
  );
}
