/**
 * 计划调整预览容器：绑定当前计划、确认/拒绝/撤销并触发规划刷新。
 */
import { useState } from 'react';
import { usePlanSessionStore } from '@/store/planSessionStore';
import { resolvePlanTargetId } from '@/lib/planTarget';
import {
  handleConfirmAdjustment,
  handleRejectAdjustment,
  handleUndoAdjustment,
} from '@/lib/adjustmentPreviewActions';
import {
  confirmPlanAdjustment,
  rejectPlanAdjustment,
  undoPlanAdjustment,
} from '@/lib/plansApi';
import { AdjustmentPreviewView } from './AdjustmentPreviewView';

interface Props {
  onNotice: (text: string) => void;
}

function AdjustmentPreviewBar({ onNotice }: Props) {
  const pending = usePlanSessionStore((s) => s.pendingAdjustment);
  const activePlanId = usePlanSessionStore((s) => s.activePlanId);
  const lastPlanId = usePlanSessionStore((s) => s.lastPlanId);
  const targetPlanId = resolvePlanTargetId(activePlanId, lastPlanId);
  const clearPending = usePlanSessionStore((s) => s.clearPendingAdjustment);
  const bumpPlanData = usePlanSessionStore((s) => s.bumpPlanDataEpoch);
  const [busy, setBusy] = useState(false);

  if (!pending && !targetPlanId) return null;

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdjustmentPreviewView
      pending={pending}
      showUndo={Boolean(targetPlanId)}
      busy={busy}
      onConfirm={() =>
        void run(async () => {
          if (!pending) {
            onNotice('无待确认预览');
            return;
          }
          await handleConfirmAdjustment({
            planId: pending.planId,
            adjustmentId: pending.id,
            confirmApi: confirmPlanAdjustment,
            clearPending,
            bumpPlanData,
            onNotice,
          });
        })
      }
      onReject={() =>
        void run(async () => {
          if (!pending) {
            onNotice('无待确认预览');
            return;
          }
          await handleRejectAdjustment({
            planId: pending.planId,
            adjustmentId: pending.id,
            rejectApi: rejectPlanAdjustment,
            clearPending,
            onNotice,
          });
        })
      }
      onUndo={() =>
        void run(async () => {
          if (!targetPlanId) {
            onNotice('未选定计划');
            return;
          }
          await handleUndoAdjustment({
            planId: targetPlanId,
            undoApi: undoPlanAdjustment,
            bumpPlanData,
            onNotice,
          });
        })
      }
    />
  );
}

export default AdjustmentPreviewBar;
