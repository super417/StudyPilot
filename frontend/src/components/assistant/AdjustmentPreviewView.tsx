/**
 * 调整预览纯展示：任务日期/旧新内容、步骤、规则结果与操作按钮。
 */
import type { PlanAdjustmentPreview } from '@/lib/plansApi';

export function checkLabel(value: unknown): string {
  if (value === 'pass') return '通过';
  if (value === 'fail') return '失败';
  if (value === 'unverified') return '未验证';
  return String(value ?? '未验证');
}

export interface AdjustmentPreviewViewProps {
  pending: PlanAdjustmentPreview | null;
  showUndo: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onReject: () => void;
  onUndo: () => void;
}

export function AdjustmentPreviewView({
  pending,
  showUndo,
  busy = false,
  onConfirm,
  onReject,
  onUndo,
}: AdjustmentPreviewViewProps) {
  if (!pending && !showUndo) return null;

  const checks = (pending?.validation?.checks ?? {}) as Record<string, unknown>;

  return (
    <div className="shrink-0 space-y-2 border-t border-brandFaint bg-white/70 px-3 py-2 text-xs text-brandDark">
      {pending ? (
        <>
          <p className="font-medium">调整预览（尚未写入）· 计划 {pending.planId.slice(0, 8)}…</p>
          <p className="whitespace-pre-wrap text-brandDark/80">{pending.decisionSummary}</p>

          <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg bg-brandFaint/40 p-2">
            <p className="font-medium text-brandDark/90">将替换的任务</p>
            {pending.diff.removedOrReplaced.length === 0 ? (
              <p className="text-brandDark/60">无</p>
            ) : (
              pending.diff.removedOrReplaced.map((item) => (
                <p key={item.id}>
                  {item.taskDate} · {item.description}
                  <span className="text-brandDark/50">（{item.status}）</span>
                </p>
              ))
            )}
            <p className="pt-1 font-medium text-brandDark/90">拟写入的任务</p>
            {pending.diff.proposedPending.length === 0 ? (
              <p className="text-brandDark/60">无</p>
            ) : (
              pending.diff.proposedPending.map((item, index) => (
                <p key={`${item.taskDate}-${index}`}>
                  {item.taskDate} · {item.description}
                </p>
              ))
            )}
          </div>

          <div className="space-y-0.5 text-brandDark/70">
            <p className="font-medium text-brandDark/90">执行步骤</p>
            {(pending.steps ?? []).map((step, index) => (
              <p key={index}>
                {String(step.step ?? 'step')} → {String(step.result ?? '')}
              </p>
            ))}
            <p className="pt-1 font-medium text-brandDark/90">规则结果</p>
            <p>结构：{checkLabel(checks.structure)}</p>
            <p>历史保护：{checkLabel(checks.protectedTaskRule)}</p>
            <p>证据定位：{checkLabel(checks.evidenceLocation)}（本批未实现）</p>
            <p>时长校验：{checkLabel(checks.duration)}（本批未实现）</p>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              className="rounded-lg bg-brand px-3 py-1.5 text-white disabled:opacity-50"
              onClick={onConfirm}
            >
              确认写入
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-brand/40 px-3 py-1.5 disabled:opacity-50"
              onClick={onReject}
            >
              拒绝
            </button>
          </div>
        </>
      ) : null}
      {showUndo ? (
        <button
          type="button"
          disabled={busy}
          className="text-left text-brandDark/70 underline-offset-2 hover:underline disabled:opacity-50"
          onClick={onUndo}
        >
          撤销最近一次已确认调整
        </button>
      ) : null}
    </div>
  );
}
