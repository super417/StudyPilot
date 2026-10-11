/**
 * 计划调整预览容器：绑定当前计划、确认/拒绝/撤销并触发规划刷新。
 */
import { useEffect, useState } from 'react';
import { usePlanSessionStore } from '@/store/planSessionStore';
import { resolvePlanTargetId, resolveUndoPlanId } from '@/lib/planTarget';
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

function remedyKeepIds(
  pending: {
    diff: {
      remedy?: {
        candidates: Array<{ sourceId: string }>;
        notArranged: Array<{ sourceId: string; reason: string }>;
      };
    };
  } | null,
): string[] | null {
  const remedy = pending?.diff.remedy;
  if (!remedy) return null;
  const skipped = new Set(
    remedy.notArranged
      .filter((item) => item.reason === '本次不补做')
      .map((item) => item.sourceId),
  );
  return remedy.candidates
    .map((item) => item.sourceId)
    .filter((id) => !skipped.has(id));
}

function AdjustmentPreviewBar({ onNotice }: Props) {
  const pending = usePlanSessionStore((s) => s.pendingAdjustment);
  const activePlanId = usePlanSessionStore((s) => s.activePlanId);
  const lastPlanId = usePlanSessionStore((s) => s.lastPlanId);
  const targetPlanId = resolvePlanTargetId(activePlanId, lastPlanId);
  const undoPlanId = resolveUndoPlanId(pending?.planId, activePlanId, lastPlanId);
  const clearPending = usePlanSessionStore((s) => s.clearPendingAdjustment);
  const setPending = usePlanSessionStore((s) => s.setPendingAdjustment);
  const bumpPlanData = usePlanSessionStore((s) => s.bumpPlanDataEpoch);
  const [busy, setBusy] = useState(false);
  const [keptActionIds, setKeptActionIds] = useState<string[]>(() =>
    proposedActionIds(pending),
  );
  const [minuteTexts, setMinuteTexts] = useState<Record<string, string>>({});
  const [remedyOption, setRemedyOption] = useState('');

  useEffect(() => {
    const ids = remedyKeepIds(pending ?? null) ?? proposedActionIds(pending ?? null);
    setKeptActionIds(ids);
    setMinuteTexts({});
    setRemedyOption(pending?.diff.remedy?.selectedOption ?? '');
  }, [pending?.id, pending?.selectionVersion]);

  const serverActionIds = remedyKeepIds(pending ?? null) ?? proposedActionIds(pending);
  const minuteState = minuteDraftState(minuteTexts);
  const optionDirty = Boolean(
    pending?.diff.remedy && remedyOption !== pending.diff.remedy.selectedOption,
  );
  const localDirty =
    pending != null &&
    (optionDirty ||
      localSelectionDirty(serverActionIds, keptActionIds, minuteTexts) ||
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
      showUndo={Boolean(undoPlanId)}
      busy={busy}
      keptActionIds={keptActionIds}
      minuteTexts={minuteTexts}
      onToggleAction={(actionId, keep) =>
        setKeptActionIds((current) => toggleProposedAction(current, actionId, keep))
      }
      onMinutes={(actionId, raw) =>
        setMinuteTexts((current) => ({ ...current, [actionId]: raw }))
      }
      remedyOption={remedyOption}
      extraDirty={optionDirty}
      onRemedyOption={setRemedyOption}
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
            optionId: pending.diff.remedy ? remedyOption : undefined,
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
          if (!undoPlanId) {
            onNotice('未选定计划');
            return;
          }
          await handleUndoAdjustment({
            planId: undoPlanId,
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
