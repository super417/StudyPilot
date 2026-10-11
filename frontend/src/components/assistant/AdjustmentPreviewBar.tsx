/**
 * 计划调整预览容器：绑定当前计划、确认/拒绝/撤销并触发规划刷新。
 */
import { useEffect, useState } from 'react';
import { usePlanSessionStore } from '@/store/planSessionStore';
import { resolvePlanTargetId } from '@/lib/planTarget';
import {
  handleConfirmAdjustment,
  handleOpenSource,
  handleRejectAdjustment,
  handleReviseAdjustment,
  handleUndoAdjustment,
  localSelectionDirty,
  minuteDraftState,
  toggleProposedAction,
} from '@/lib/adjustmentPreviewActions';
import {
  confirmPlanAdjustment,
  openOwnedChunk,
  rejectPlanAdjustment,
  revisePlanAdjustment,
  undoPlanAdjustment,
} from '@/lib/plansApi';
import { AdjustmentPreviewView } from './AdjustmentPreviewView';

interface Props {
  onNotice: (text: string) => void;
}

function proposedActionIds(
  pending: { diff: { proposedPending: Array<{ actionId?: string }> } } | null,
): string[] {
  return (pending?.diff.proposedPending ?? [])
    .map((item) => item.actionId)
    .filter((id): id is string => Boolean(id));
}

function AdjustmentPreviewBar({ onNotice }: Props) {
  const pending = usePlanSessionStore((s) => s.pendingAdjustment);
  const activePlanId = usePlanSessionStore((s) => s.activePlanId);
  const lastPlanId = usePlanSessionStore((s) => s.lastPlanId);
  const targetPlanId = resolvePlanTargetId(activePlanId, lastPlanId);
  const clearPending = usePlanSessionStore((s) => s.clearPendingAdjustment);
  const setPending = usePlanSessionStore((s) => s.setPendingAdjustment);
  const bumpPlanData = usePlanSessionStore((s) => s.bumpPlanDataEpoch);
  const [busy, setBusy] = useState(false);
  const [keptActionIds, setKeptActionIds] = useState<string[]>(() =>
    proposedActionIds(pending),
  );
  const [minuteTexts, setMinuteTexts] = useState<Record<string, string>>({});

  useEffect(() => {
    const ids = proposedActionIds(pending ?? null);
    setKeptActionIds(ids);
    setMinuteTexts({});
  }, [pending?.id, pending?.selectionVersion]);

  const serverActionIds = proposedActionIds(pending);
  const minuteState = minuteDraftState(minuteTexts);
  const localDirty =
    pending != null &&
    (localSelectionDirty(serverActionIds, keptActionIds, minuteTexts) ||
      minuteState.invalidIds.length > 0);

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
      keptActionIds={keptActionIds}
      minuteTexts={minuteTexts}
      onToggleAction={(actionId, keep) =>
        setKeptActionIds((current) => toggleProposedAction(current, actionId, keep))
      }
      onMinutes={(actionId, raw) =>
        setMinuteTexts((current) => ({ ...current, [actionId]: raw }))
      }
      onRevise={() =>
        void run(async () => {
          if (!pending) {
            onNotice('无待确认预览');
            return;
          }
          if (minuteState.invalidIds.length > 0) {
            onNotice('预计分钟必须是正整数');
            return;
          }
          await handleReviseAdjustment({
            pending,
            keepActionIds: keptActionIds,
            minuteOverrides: minuteState.overrides,
            reviseApi: revisePlanAdjustment,
            setPending,
            onNotice,
          });
        })
      }
      onOpenSource={(ref) =>
        void run(async () => {
          await handleOpenSource({
            ref,
            lookup: openOwnedChunk,
            onNotice,
          });
        })
      }
      onConfirm={() =>
        void run(async () => {
          if (!pending) {
            onNotice('无待确认预览');
            return;
          }
          await handleConfirmAdjustment({
            planId: pending.planId,
            adjustmentId: pending.id,
            selectionVersion: pending.selectionVersion,
            validation: pending.validation,
            localDirty,
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
