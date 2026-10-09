import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/httpClient';
import {
  handleConfirmAdjustment,
  handleUndoAdjustment,
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
});
