import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/httpClient';
import {
  applyMinuteDraft,
  handleConfirmAdjustment,
  handleOpenSource,
  handleReviseAdjustment,
  handleUndoAdjustment,
  localSelectionDirty,
  minuteDraftState,
  toggleProposedAction,
} from '@/lib/adjustmentPreviewActions';
import { usePlanSessionStore } from '@/store/planSessionStore';

describe('adjustmentPreviewActions C6', () => {
  beforeEach(() => {
    usePlanSessionStore.setState({
      pendingAdjustment: {
        id: 'adj-9',
        planId: 'plan-viewed',
        status: 'pending',
        instruction: 'x',
        decisionSummary: '摘要',
        summary: '摘要',
        phases: 2,
        usedDocs: [],
        evidenceRefs: [],
        steps: [],
        validation: { ok: true, checks: {} },
        diff: {
          removedOrReplaced: [],
          proposedPending: [],
          protectedKept: 0,
        },
      },
      activePlanId: 'plan-viewed',
      lastPlanId: 'plan-stale-generated',
      planDataEpoch: 0,
    });
  });

  it('confirm calls API with pending planId and bumps reload epoch', async () => {
    const confirmApi = vi.fn().mockResolvedValue({
      status: 'confirmed',
      decisionSummary: '写入成功',
    });
    const notices: string[] = [];
    const clearPending = vi.fn(() =>
      usePlanSessionStore.setState({ pendingAdjustment: null }),
    );
    const bumpPlanData = vi.fn(() => usePlanSessionStore.getState().bumpPlanDataEpoch());

    const result = await handleConfirmAdjustment({
      planId: 'plan-viewed',
      adjustmentId: 'adj-9',
      confirmApi,
      clearPending,
      bumpPlanData,
      onNotice: (text) => notices.push(text),
    });

    expect(result).toBe('success');
    expect(confirmApi).toHaveBeenCalledWith('plan-viewed', 'adj-9');
    expect(clearPending).toHaveBeenCalledOnce();
    expect(bumpPlanData).toHaveBeenCalledOnce();
    expect(usePlanSessionStore.getState().planDataEpoch).toBe(1);
    expect(notices[0]).toContain('写入成功');
    expect(notices.some((n) => n.includes('可重新描述'))).toBe(false);
  });

  it('undo uses active target planId and bumps reload', async () => {
    const undoApi = vi.fn().mockResolvedValue({
      status: 'undone',
      decisionSummary: '撤销成功',
    });
    const notices: string[] = [];
    const bumpPlanData = vi.fn(() => usePlanSessionStore.getState().bumpPlanDataEpoch());
    const target = usePlanSessionStore.getState().activePlanId!;

    const result = await handleUndoAdjustment({
      planId: target,
      undoApi,
      bumpPlanData,
      onNotice: (text) => notices.push(text),
    });

    expect(result).toBe('success');
    expect(undoApi).toHaveBeenCalledWith('plan-viewed');
    expect(undoApi).not.toHaveBeenCalledWith('plan-stale-generated');
    expect(bumpPlanData).toHaveBeenCalledOnce();
    expect(usePlanSessionStore.getState().planDataEpoch).toBe(1);
    expect(notices[0]).toContain('撤销成功');
  });

  it('conflict does not treat as success, keeps pending, no reload bump', async () => {
    const confirmApi = vi.fn().mockRejectedValue(
      new ApiError(409, 'ADJUSTMENT_CONFLICT', '规划已变化'),
    );
    const notices: string[] = [];
    const clearPending = vi.fn();
    const bumpPlanData = vi.fn();

    const result = await handleConfirmAdjustment({
      planId: 'plan-viewed',
      adjustmentId: 'adj-9',
      confirmApi,
      clearPending,
      bumpPlanData,
      onNotice: (text) => notices.push(text),
    });

    expect(result).toBe('conflict');
    expect(clearPending).not.toHaveBeenCalled();
    expect(bumpPlanData).not.toHaveBeenCalled();
    expect(usePlanSessionStore.getState().planDataEpoch).toBe(0);
    expect(usePlanSessionStore.getState().pendingAdjustment?.id).toBe('adj-9');
    expect(notices.join('\n')).toContain('可重新描述调整说明以生成新预览');
    expect(notices.join('\n')).not.toContain('写入成功');
  });

  it('blocks confirm when duration or evidence is unknown or failed', async () => {
    const confirmApi = vi.fn();
    const notices: string[] = [];
    const result = await handleConfirmAdjustment({
      planId: 'plan-viewed',
      adjustmentId: 'adj-9',
      validation: {
        ok: false,
        checks: { evidenceLocation: 'pass', duration: 'unknown', schedule: 'pass' },
      },
      confirmApi,
      clearPending: vi.fn(),
      bumpPlanData: vi.fn(),
      onNotice: (text) => notices.push(text),
    });
    expect(result).toBe('blocked');
    expect(confirmApi).not.toHaveBeenCalled();
    expect(notices.join('\n')).toContain('不能确认');
    expect(usePlanSessionStore.getState().planDataEpoch).toBe(0);
  });

  it('revise sends the seen selection and does not reload the live plan', async () => {
    const pending = usePlanSessionStore.getState().pendingAdjustment!;
    pending.selectionVersion = 2;
    pending.diff.proposedPending = [
      { actionId: 'a0', taskDate: '2026-10-11', description: '甲', status: 'pending', estimatedMinutes: 20 },
      { actionId: 'a1', taskDate: '2026-10-12', description: '乙', status: 'pending', estimatedMinutes: 20 },
    ];
    const kept = toggleProposedAction(['a0', 'a1'], 'a1', false);
    const minutes = applyMinuteDraft({}, 'a0', '35');
    const reviseApi = vi.fn().mockResolvedValue({
      ...pending,
      selectionVersion: 3,
      decisionSummary: '已重算',
      summary: '已重算',
    });
    const setPending = vi.fn();
    const notices: string[] = [];
    const result = await handleReviseAdjustment({
      pending,
      keepActionIds: kept,
      minuteOverrides: minutes,
      reviseApi,
      setPending,
      onNotice: (text) => notices.push(text),
    });
    expect(result).toBe('success');
    expect(kept).toEqual(['a0']);
    expect(minutes).toEqual({ a0: 35 });
    expect(reviseApi).toHaveBeenCalledWith('plan-viewed', 'adj-9', {
      selectionVersion: 2,
      keepActionIds: ['a0'],
      minuteOverrides: { a0: 35 },
    });
    expect(setPending).toHaveBeenCalledOnce();
    expect(usePlanSessionStore.getState().planDataEpoch).toBe(0);
    expect(notices[0]).toContain('尚未写入');
  });

  it('missing source says unavailable and does not invent a replacement', async () => {
    const notices: string[] = [];
    const lookup = vi.fn().mockRejectedValue(new Error('missing'));
    const result = await handleOpenSource({
      ref: { kind: 'document', docId: 'doc-1', chunkIndex: 0, contentHash: 'abc' },
      lookup,
      onNotice: (text) => notices.push(text),
    });
    expect(result).toBe('unavailable');
    expect(lookup).toHaveBeenCalledWith('doc-1', 0, 'abc');
    expect(notices[0]).toBe('来源不可用');
  });

  it('does not call confirm while the local kept set differs from the server preview', async () => {
    const serverIds = ['a0', 'a1'];
    const kept = toggleProposedAction(serverIds, 'a1', false);
    const confirmApi = vi.fn();
    const notices: string[] = [];
    const result = await handleConfirmAdjustment({
      planId: 'plan-viewed',
      adjustmentId: 'adj-9',
      selectionVersion: 1,
      localDirty: localSelectionDirty(serverIds, kept, {}),
      validation: { ok: true, checks: { evidenceLocation: 'pass', duration: 'pass', schedule: 'pass' } },
      confirmApi,
      clearPending: vi.fn(),
      bumpPlanData: vi.fn(),
      onNotice: (text) => notices.push(text),
    });
    expect(kept).toEqual(['a0']);
    expect(result).toBe('blocked');
    expect(confirmApi).not.toHaveBeenCalled();
    expect(notices[0]).toContain('尚未重新计算');
  });

  it('drops a previous valid minute when the visible text is not an integer', () => {
    const previous = applyMinuteDraft({}, 'a0', '30');
    expect(previous).toEqual({ a0: 30 });
    const visible = { a0: 'abc' };
    const parsed = minuteDraftState(visible);
    expect(parsed.invalidIds).toEqual(['a0']);
    expect(parsed.overrides).toEqual({});
    expect(parsed.overrides).not.toEqual(previous);
  });

  it('keeps the local selection when recompute fails', async () => {
    const pending = usePlanSessionStore.getState().pendingAdjustment!;
    pending.selectionVersion = 1;
    const kept = ['a0'];
    const reviseApi = vi.fn().mockRejectedValue(
      new ApiError(409, 'ADJUSTMENT_CONFLICT', '选择包含未知任务'),
    );
    const setPending = vi.fn();
    const result = await handleReviseAdjustment({
      pending,
      keepActionIds: kept,
      minuteOverrides: {},
      reviseApi,
      setPending,
      onNotice: () => undefined,
    });
    expect(result).toBe('conflict');
    expect(setPending).not.toHaveBeenCalled();
    expect(kept).toEqual(['a0']);
  });
});
