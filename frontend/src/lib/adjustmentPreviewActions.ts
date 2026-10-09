/**
 * 调整预览操作层：确认/拒绝/撤销；供 UI 与操作测试共用。
 */
import { ApiError } from '@/lib/httpClient';

export type NoticeFn = (text: string) => void;

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
  confirmApi: (
    planId: string,
    adjustmentId: string,
  ) => Promise<{ decisionSummary?: string; status: string }>;
  clearPending: () => void;
  bumpPlanData: () => void;
  onNotice: NoticeFn;
}): Promise<'success' | 'conflict' | 'error'> {
  try {
    const row = await opts.confirmApi(opts.planId, opts.adjustmentId);
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
