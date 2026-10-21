/**
 * Roadmap 阶段全屏详情。
 * 左：勾选任务模块；右：所选任务的学习路线与课程资源，各自独立小卡片。
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, ExternalLink, Map } from 'lucide-react';
import { ApiError } from '@/lib/httpClient';
import { fetchPhaseDetail, type PhaseDetailResponse } from '@/lib/phasesApi';
import type { DailyTask } from '@/mocks/types';

export interface PhaseDetailPageProps {
  phaseId: string;
  onClose: () => void;
  onAdjust?: () => void;
  onToggleTask?: (task: DailyTask) => void;
}

/** 左侧简述学习路线正文（冒号后的内容），完整页码清单留在右侧。 */
function taskSummary(description: string, max = 48): string {
  const text = description.replace(/\s+/g, ' ').trim();
  if (!text) return '（无内容总结）';
  const colon = text.search(/[：:]/);
  const body = (colon >= 0 ? text.slice(colon + 1) : text).trim() || text;
  if (body.length <= max) return body;
  return `${body.slice(0, max)}…`;
}

export function LearningModuleCard({
  task,
  index,
}: {
  task: DailyTask;
  index: number;
}) {
  const resourceLocation = [task.chapterTitle?.trim(), task.sectionTitle?.trim()]
    .filter(Boolean)
    .join(' · ');
  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-400">
            模块 {index + 1} · {task.taskDate}
            {task.weekLabel ? ` · ${task.weekLabel}` : ''}
          </p>
          <h3 className="mt-1 text-sm font-semibold text-brandDark">学习路线</h3>
        </div>
        {task.status === 'done' ? (
          <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
            已完成
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            待学习
          </span>
        )}
      </div>

      <div className="mb-3 flex gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-100">
        <Map className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />
        <p className="min-w-0 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
          {task.description || '暂无学习路线说明'}
        </p>
      </div>

      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-100">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-brandDark">
          <BookOpen className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          课程资源
        </div>
        {task.resourceUrl ? (
          <div>
            <a
              href={task.resourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200 transition-colors hover:bg-emerald-100"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              打开学习资源
            </a>
            {resourceLocation && (
              <span className="ml-2 text-xs text-slate-600">{resourceLocation}</span>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400">该任务暂未关联学习资源</p>
        )}
      </div>
    </article>
  );
}

function PhaseDetailPage({ phaseId, onClose, onAdjust, onToggleTask }: PhaseDetailPageProps) {
  const [detail, setDetail] = useState<PhaseDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 左侧勾选：决定右侧展示哪些学习模块（与「完成」状态分开） */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void fetchPhaseDetail(phaseId)
      .then((res) => {
        setDetail(res);
        // 默认勾选第一项，右侧立刻有内容
        setSelectedIds(res.tasks[0] ? [res.tasks[0].id] : []);
      })
      .catch((err) => {
        setDetail(null);
        setSelectedIds([]);
        setError(err instanceof ApiError ? err.message : '阶段详情加载失败');
      })
      .finally(() => setLoading(false));
  }, [phaseId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selectedTasks = useMemo(() => {
    if (!detail) return [];
    const set = new Set(selectedIds);
    return detail.tasks.filter((t) => set.has(t.id));
  }, [detail, selectedIds]);

  const toggleSelect = (taskId: string) => {
    setSelectedIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId],
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-[#F7FAF8]">
      <header className="sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="mb-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brandDark"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回 Roadmap
            </button>
            {detail ? (
              <>
                <h1 className="text-xl font-semibold text-brandDark sm:text-2xl">
                  {detail.phaseName}
                  {detail.subtitle ? (
                    <span className="ml-2 text-base font-normal text-slate-500">
                      {detail.subtitle}
                    </span>
                  ) : null}
                </h1>
                <p className="mt-1 text-sm text-slate-500">{detail.dateRange}</p>
              </>
            ) : (
              <h1 className="text-xl font-semibold text-brandDark">阶段详情</h1>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onAdjust ? (
              <button
                type="button"
                onClick={onAdjust}
                className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-brandDark ring-1 ring-brand/30 hover:bg-brandFaint"
              >
                调整
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-brandDark ring-1 ring-brand/30 hover:bg-brandFaint"
            >
              收起
            </button>
            {detail?.isCurrent ? (
              <span className="rounded-full bg-brandDark px-3 py-1.5 text-xs font-medium text-white">
                当前阶段
              </span>
            ) : detail?.isCompleted ? (
              <span className="rounded-full bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">
                已完成
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 p-4 md:grid-cols-2 md:gap-8 sm:p-6">
          {loading ? (
            <p className="text-sm text-slate-500 md:col-span-2">加载阶段详情…</p>
          ) : null}
          {error ? (
            <p className="text-sm text-dangerText md:col-span-2" role="alert">
              {error}
            </p>
          ) : null}

          {detail ? (
            <>
              <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-brandDark">阶段任务</h2>
                  <span className="text-xs text-slate-400">
                    进度 {detail.progressPercent}% · {detail.tasks.length} 项
                  </span>
                </div>
                <p className="mb-4 text-xs text-slate-400">
                  勾选左侧任务，右侧显示对应学习路线与课程资源；点「完成」标记打卡状态。
                </p>
                {detail.tasks.length === 0 ? (
                  <p className="text-sm text-slate-400">该阶段还没有每日任务</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.tasks.map((task, index) => {
                      const selected = selectedIds.includes(task.id);
                      return (
                        <li
                          key={task.id}
                          className={index % 2 === 0 ? 'mr-6' : 'ml-6'}
                        >
                          <div
                            className={`flex items-start gap-3 rounded-2xl px-3 py-2.5 ring-1 transition-colors ${
                              selected
                                ? 'bg-blue-50 ring-blue-200'
                                : 'bg-slate-50 ring-transparent hover:bg-slate-100'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-1 accent-blue-600"
                              checked={selected}
                              onChange={() => toggleSelect(task.id)}
                              aria-label={`勾选任务以查看学习计划：${task.description}`}
                            />
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left"
                              onClick={() => toggleSelect(task.id)}
                            >
                              <p className="text-xs text-slate-400">
                                {task.taskDate}
                                {task.weekLabel ? ` · ${task.weekLabel}` : ''}
                                {task.status === 'done' ? ' · 已完成' : ''}
                              </p>
                              <p className="mt-0.5 text-sm text-brandDark">{taskSummary(task.description)}</p>
                            </button>
                            <button
                              type="button"
                              className="shrink-0 rounded-full px-2 py-1 text-[11px] font-medium text-brandDark ring-1 ring-brand/25 hover:bg-white"
                              onClick={() => {
                                onToggleTask?.(task);
                                setDetail((prev) => {
                                  if (!prev) return prev;
                                  const nextStatus =
                                    task.status === 'done' ? 'pending' : 'done';
                                  return {
                                    ...prev,
                                    tasks: prev.tasks.map((t) =>
                                      t.id === task.id ? { ...t, status: nextStatus } : t,
                                    ),
                                  };
                                });
                              }}
                            >
                              {task.status === 'done' ? '改回待做' : '完成'}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
                <h2 className="mb-1 text-base font-semibold text-brandDark">学习计划</h2>
                <p className="mb-4 text-xs text-slate-400">
                  已选 {selectedTasks.length} 个模块 · 每项独立展示路线与课程资源
                </p>
                {selectedTasks.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                    请在左侧勾选任务，查看具体学习路线与课程资源
                  </p>
                ) : (
                  <div className="space-y-4">
                    {selectedTasks.map((task, index) => (
                      <LearningModuleCard key={task.id} task={task} index={index} />
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default PhaseDetailPage;
