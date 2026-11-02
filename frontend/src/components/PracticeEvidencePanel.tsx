import { formatBillingDateTime } from '@/lib/billingDateTime';
import { useEffect, useState } from 'react';
import { fetchPracticeEvidence, type PracticeEvidenceResponse } from '@/lib/practiceApi';

export function PracticeEvidenceView({ data }: { data: PracticeEvidenceResponse }) {
  return <div className="mt-2 space-y-3 text-xs text-slate-600">
    <p>{data.question.practiceType === 'reinforce_retest' ? '补强完成后的同阶段新题重测' : '普通练习'} · 所属阶段：{data.question.phaseName ?? '未关联阶段'}</p>
    {data.question.practiceType === 'reinforce_retest' && <p>用于检验补强后的同阶段知识；重新作答会追加记录，保留历史判分。</p>}
    {!data.evidence.length && <p>尚无判分记录，作答后可查看依据。</p>}
    {data.evidence.map((row) => <article key={row.id} className="rounded-xl bg-slate-50 p-3">
      <p>{row.evidenceType === 'quiz' ? '答题判分' : row.evidenceType === 'explanation' ? '讲解评估' : row.evidenceType} · {formatBillingDateTime(row.createdAt)} · {row.phaseName ?? '未关联阶段'}</p>
      <p>结果：{row.result === 'correct' ? '正确' : row.result === 'partial' ? '部分正确' : '错误'}</p>
      <p className="whitespace-pre-wrap">当次作答：{row.answerText}</p>
      <p className="whitespace-pre-wrap">当次理由：{row.reason ?? '未保存理由'}</p>
      <p>{row.source.label}</p>
      <p>{row.source.quoteCheck === 'matched' ? '原文短句已做字面核对，不代表语义支持判分。' : row.source.quoteCheck === 'insufficient' ? '依据不足：未能核对支持判断的原文短句。' : '历史记录的引用未经核验，不能确认支持判分。'}</p>
      {row.source.quoteCheck === 'matched' && row.source.sourceQuote && <p className="whitespace-pre-wrap break-words">当次核对短句：{row.source.sourceQuote}</p>}
      {row.source.status === 'available' && <details><summary>查看当前《{row.source.filename}》第 {(row.source.chunkIndex ?? 0) + 1} 段{row.source.pageStart != null ? ` · 第 ${row.source.pageStart} 页` : ''}</summary><pre className="whitespace-pre-wrap break-words">{row.source.content}</pre></details>}
    </article>)}
  </div>;
}

export default function PracticeEvidencePanel({ questionId, revision }: { questionId: string; revision: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PracticeEvidenceResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError(''); setData(null);
    void fetchPracticeEvidence(questionId).then((body) => { if (active) setData(body); }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '判分记录读取失败，请重试'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [questionId, open, revision, refresh]);
  return <section className="mt-3">
    <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="text-xs underline">判分记录与依据</button>
    {open && <>
      <button type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)} className="ml-3 text-xs underline">刷新记录</button>
      {loading && <p role="status">正在读取判分记录…</p>}
      {error && <p role="alert">{error}</p>}
      {data && <PracticeEvidenceView data={data} />}
    </>}
  </section>;
}
