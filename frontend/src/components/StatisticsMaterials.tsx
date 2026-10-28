import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/httpClient';
import { listDocuments, type ListedDocument } from '@/lib/documentsApi';
import { openOwnedChunk } from '@/lib/plansApi';

/** 只展示当前用户的真实资料与已解析文本，不冒充原文件预览。 */
export default function StatisticsMaterials({ onUpload }: { onUpload?: () => void }) {
  const [documents, setDocuments] = useState<ListedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<ListedDocument | null>(null);
  const [index, setIndex] = useState(0);
  const [chunk, setChunk] = useState<Awaited<ReturnType<typeof openOwnedChunk>> | null>(null);
  const [chunkLoading, setChunkLoading] = useState(false);
  const [chunkError, setChunkError] = useState<string | null>(null);
  const [chunkRetry, setChunkRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void listDocuments(controller.signal).then((res) => {
      if (!controller.signal.aborted) setDocuments(res.documents);
    }).catch((e) => {
      if (!controller.signal.aborted) setError(e instanceof ApiError ? e.message : '资料加载失败，请重试');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    let active = true;
    setChunk(null);
    setChunkError(null);
    setChunkLoading(false);
    if (selected && selected.chunks > 0) {
      setChunkLoading(true);
      void openOwnedChunk(selected.docId, index).then((res) => {
        if (active) setChunk(res);
      }).catch((e) => {
        if (active) setChunkError(e instanceof ApiError ? e.message : '文本加载失败，请重试');
      }).finally(() => { if (active) setChunkLoading(false); });
    }
    return () => { active = false; };
  }, [selected, index, chunkRetry]);

  const buttonClass = 'rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-40';
  return (
    <section id="statistics-materials" aria-label="上传资料列表" className="squircle-card bg-white p-5 shadow-sm ring-1 ring-slate-100">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-800">上传资料</h2>
        {onUpload ? <button type="button" onClick={onUpload} className={buttonClass}>去上传资料</button> : null}
      </div>
      {loading ? <p role="status" className="text-sm text-slate-500">正在加载资料…</p> : error ? (
        <div role="alert" className="text-sm text-dangerText">{error} <button type="button" onClick={() => setRetry((v) => v + 1)} className={buttonClass}>重试</button></div>
      ) : !documents.length ? <p className="text-sm text-slate-500">还没有上传资料，可以到个人中心上传讲义或笔记。</p> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ul className="max-h-96 space-y-2 overflow-y-auto" aria-label="资料文件">
            {documents.map((doc) => (
              <li key={doc.docId}>
                <button type="button" aria-pressed={selected?.docId === doc.docId} onClick={() => { setSelected(doc); setIndex(0); }} className={`w-full rounded-xl border p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${selected?.docId === doc.docId ? 'border-brand bg-brandFaint' : 'border-slate-100 hover:bg-slate-50'}`}>
                  <span className="block break-all text-sm font-medium text-slate-800">{doc.filename}</span>
                  <span className="mt-1 block text-xs text-slate-500">{doc.fileType.toUpperCase()} · {doc.ready ? '已解析' : '尚未就绪'} · {doc.chunks} 个文本片段</span>
                  <span className="mt-1 block text-xs text-slate-400">上传时间：{doc.uploadedAt && !Number.isNaN(Date.parse(doc.uploadedAt)) ? new Date(doc.uploadedAt).toLocaleString('zh-CN') : '未知'}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 rounded-xl bg-slate-50 p-4" aria-label="资料解析文本">
            {!selected ? <p className="text-sm text-slate-500">点击一份资料查看内容。</p> : (
              <>
                <h3 className="break-all text-sm font-semibold text-slate-800">{selected.filename}</h3>
                <p className="mt-1 text-xs text-slate-500">已解析文本，不含原文件排版；暂不支持原文件下载。</p>
                {selected.chunks > 0 ? (
                  <>
                    <div className="my-3 flex flex-wrap items-center gap-2">
                      <button type="button" disabled={index === 0} onClick={() => setIndex((v) => v - 1)} className={buttonClass}>上一段</button>
                      <span className="text-xs text-slate-500">{index + 1} / {selected.chunks}</span>
                      <button type="button" disabled={index >= selected.chunks - 1} onClick={() => setIndex((v) => v + 1)} className={buttonClass}>下一段</button>
                    </div>
                    {chunkLoading ? <p role="status" className="text-sm text-slate-500">正在加载文本…</p> : chunkError ? <div role="alert" className="text-sm text-dangerText">{chunkError} <button type="button" onClick={() => setChunkRetry((v) => v + 1)} className={buttonClass}>重试</button></div> : chunk ? (
                      <>
                        {chunk.pageStart != null ? <p className="mb-2 text-xs text-slate-400">第 {chunk.pageStart} 页</p> : null}
                        <p className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{chunk.snippet}</p>
                      </>
                    ) : null}
                  </>
                ) : <p className="mt-3 text-sm text-slate-500">这份资料没有可预览的解析文本。</p>}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
