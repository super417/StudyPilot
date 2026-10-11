/**
 * 调整预览操作层：确认/拒绝/撤销；供 UI 与操作测试共用。
 */
import { ApiError } from '@/lib/httpClient';
import type { EvidenceRef, PlanAdjustmentPreview } from '@/lib/plansApi';

export type NoticeFn = (text: string) => void;

const BLOCKED = new Set(['fail', 'unknown', 'insufficient', 'unverified']);

export function adjustmentCanConfirm(
  validation: { ok?: unknown; checks?: Record<string, unknown> } | null | undefined,
): boolean {
  if (!validation || validation.ok !== true) return false;
  const checks = validation.checks ?? {};
  for (const key of ['evidenceLocation', 'duration', 'schedule']) {
    const value = checks[key];
    if (value == null || BLOCKED.has(String(value))) return false;
  }
  return true;
}

export function toggleProposedAction(
  kept: string[],
  actionId: string,
  keep: boolean,
): string[] {
  if (keep) return kept.includes(actionId) ? kept : [...kept, actionId];
  return kept.filter((id) => id !== actionId);
}

export function effectivePreviewTasks(pending: PlanAdjustmentPreview): Array<{
  actionId?: string;
  taskDate: string;
  description: string;
  status?: string;
  estimatedMinutes?: number | null;
  phaseName?: string;
}> {
  const proposed = pending.diff.proposedPending ?? [];
  const candidates = pending.diff.candidates ?? [];
  const selected = new Map(
    proposed
      .filter((item) => item.actionId)
      .map((item) => [item.actionId as string, item]),
  );
  const source = candidates.length > 0 ? candidates : proposed;
  return source.map((item) => {
    const chosen = item.actionId ? selected.get(item.actionId) : undefined;
    return {
      ...item,
      estimatedMinutes: chosen
        ? (chosen.estimatedMinutes ?? null)
        : (item.estimatedMinutes ?? null),
    };
  });
}

export function minuteInputValue(
  minuteTexts: Record<string, string>,
  actionId: string,
  estimatedMinutes: number | null | undefined,
): string {
  if (Object.prototype.hasOwnProperty.call(minuteTexts, actionId)) {
    return minuteTexts[actionId];
  }
  if (estimatedMinutes == null) return '';
  return String(estimatedMinutes);
}

export function minuteDraftState(texts: Record<string, string>): {
  overrides: Record<string, number>;
  invalidIds: string[];
} {
  const overrides: Record<string, number> = {};
  const invalidIds: string[] = [];
  for (const [actionId, raw] of Object.entries(texts)) {
    const text = raw.trim();
    if (!text) continue;
    if (!/^[1-9]\d*$/.test(text)) {
      invalidIds.push(actionId);
      continue;
    }
    overrides[actionId] = Number(text);
  }
  return { overrides, invalidIds };
}

export function localSelectionDirty(
  serverActionIds: string[],
  keptActionIds: string[],
  minuteTexts: Record<string, string>,
): boolean {
  const server = [...serverActionIds].sort().join('\0');
  const kept = [...keptActionIds].sort().join('\0');
  if (server !== kept) return true;
  return Object.values(minuteTexts).some((value) => value.trim() !== '');
}

export function applyMinuteDraft(
  draft: Record<string, number>,
  actionId: string,
  raw: string,
): Record<string, number> {
  const next = { ...draft };
  const parsed = minuteDraftState({ [actionId]: raw });
  if (parsed.invalidIds.includes(actionId) || raw.trim() === '') {
    delete next[actionId];
    return next;
  }
  next[actionId] = parsed.overrides[actionId];
  return next;
}

export function sourcePlaceLabel(ref: {
  filename?: string;
  pageStart?: number | null;
  chunkIndex?: number | null;
}): string {
  const name = ref.filename || '未命名文件';
  if (typeof ref.pageStart === 'number') return `${name} · 第${ref.pageStart}页`;
  if (typeof ref.chunkIndex === 'number') return `${name} · 片段 ${ref.chunkIndex}`;
  return name;
}

function conflictOrErrorNotice(err: unknown, onNotice: NoticeFn): void {
  const message = err instanceof ApiError ? err.message : '操作失败，请稍后重试';
  if (err instanceof ApiError && err.code === 'ADJUSTMENT_CONFLICT') {
    onNotice(`${message}\n可重新描述调整说明以生成新预览。`);
    return;
  }
  onNotice(message);
}

export async function handleConfirmAdjustment(opts: {
  planId: string;
  adjustmentId: string;
  selectionVersion?: number;
  validation?: { ok?: unknown; checks?: Record<string, unknown> } | null;
  localDirty?: boolean;
  confirmApi: (
    planId: string,
    adjustmentId: string,
    selectionVersion?: number,
  ) => Promise<{ decisionSummary?: string; status: string }>;
  clearPending: () => void;
  bumpPlanData: () => void;
  onNotice: NoticeFn;
}): Promise<'success' | 'conflict' | 'error' | 'blocked'> {
  if (opts.localDirty) {
    opts.onNotice('本地勾选或分钟尚未重新计算，不能确认。');
    return 'blocked';
  }
  if (opts.validation && !adjustmentCanConfirm(opts.validation)) {
    opts.onNotice('时长、日期或依据未通过，不能确认。');
    return 'blocked';
  }
  try {
    const row =
      opts.selectionVersion == null
        ? await opts.confirmApi(opts.planId, opts.adjustmentId)
        : await opts.confirmApi(
            opts.planId,
            opts.adjustmentId,
            opts.selectionVersion,
          );
    opts.clearPending();
    opts.bumpPlanData();
    opts.onNotice(row.decisionSummary || '已确认并写入规划。');
    return 'success';
  } catch (err) {
    conflictOrErrorNotice(err, opts.onNotice);
    return err instanceof ApiError && err.code === 'ADJUSTMENT_CONFLICT'
      ? 'conflict'
      : 'error';
  }
}

export async function handleRejectAdjustment(opts: {
  planId: string;
  adjustmentId: string;
  rejectApi: (planId: string, adjustmentId: string) => Promise<unknown>;
  clearPending: () => void;
  onNotice: NoticeFn;
}): Promise<'success' | 'conflict' | 'error'> {
  try {
    await opts.rejectApi(opts.planId, opts.adjustmentId);
    opts.clearPending();
    opts.onNotice('已拒绝该预览，原规划未改动。可重新说明调整需求以生成新预览。');
    return 'success';
  } catch (err) {
    conflictOrErrorNotice(err, opts.onNotice);
    return err instanceof ApiError && err.code === 'ADJUSTMENT_CONFLICT'
      ? 'conflict'
      : 'error';
  }
}

export async function handleUndoAdjustment(opts: {
  planId: string;
  undoApi: (planId: string) => Promise<{ decisionSummary?: string; status: string }>;
  bumpPlanData: () => void;
  onNotice: NoticeFn;
}): Promise<'success' | 'conflict' | 'error'> {
  try {
    const row = await opts.undoApi(opts.planId);
    opts.bumpPlanData();
    opts.onNotice(row.decisionSummary || '已撤销最近一次确认的调整。');
    return 'success';
  } catch (err) {
    conflictOrErrorNotice(err, opts.onNotice);
    return err instanceof ApiError && err.code === 'ADJUSTMENT_CONFLICT'
      ? 'conflict'
      : 'error';
  }
}

export async function handleReviseAdjustment(opts: {
  pending: PlanAdjustmentPreview;
  keepActionIds: string[];
  minuteOverrides: Record<string, number>;
  reviseApi: (
    planId: string,
    adjustmentId: string,
    body: {
      selectionVersion: number;
      keepActionIds: string[];
      minuteOverrides?: Record<string, number>;
    },
  ) => Promise<PlanAdjustmentPreview>;
  setPending: (preview: PlanAdjustmentPreview) => void;
  onNotice: NoticeFn;
}): Promise<'success' | 'conflict' | 'error'> {
  const selectionVersion = opts.pending.selectionVersion ?? 1;
  try {
    const row = await opts.reviseApi(opts.pending.planId, opts.pending.id, {
      selectionVersion,
      keepActionIds: opts.keepActionIds,
      minuteOverrides: opts.minuteOverrides,
    });
    opts.setPending({
      ...opts.pending,
      ...row,
      planId: opts.pending.planId,
      summary: row.decisionSummary || row.summary || opts.pending.summary,
    });
    opts.onNotice('已按勾选和预计分钟重新计算，规划尚未写入。');
    return 'success';
  } catch (err) {
    conflictOrErrorNotice(err, opts.onNotice);
    return err instanceof ApiError && err.code === 'ADJUSTMENT_CONFLICT'
      ? 'conflict'
      : 'error';
  }
}

export async function handleOpenSource(opts: {
  ref: EvidenceRef;
  lookup: (
    docId: string,
    chunkIndex: number,
    contentHash?: string,
  ) => Promise<{ filename: string; snippet: string }>;
  onNotice: NoticeFn;
}): Promise<'opened' | 'unavailable'> {
  if (!opts.ref.docId || opts.ref.chunkIndex == null) {
    opts.onNotice('来源不可用');
    return 'unavailable';
  }
  try {
    const row = await opts.lookup(
      opts.ref.docId,
      opts.ref.chunkIndex,
      opts.ref.contentHash,
    );
    opts.onNotice(`${row.filename}\n${row.snippet}`);
    return 'opened';
  } catch {
    opts.onNotice('来源不可用');
    return 'unavailable';
  }
}
