import { describe, expect, it, vi } from 'vitest';
import { streamPlanRegenerate, type PlanStreamHandlers } from '@/lib/plansApi';

vi.mock('@/lib/sseClient', () => ({
  consumeSse: async (opts: {
    onEvent: (event: string, data: Record<string, unknown>) => void;
  }) => {
    opts.onEvent('preview', {
      id: 'adj-1',
      planId: 'plan-1',
      status: 'pending',
      instruction: '压缩阶段',
      decisionSummary: '预览摘要',
      summary: '预览摘要',
      phases: 2,
      usedDocs: [],
      validation: { ok: true, evidenceTimeChecks: 'unverified' },
      steps: [{ step: 'await_confirm', result: 'pending' }],
      evidenceRefs: [],
      diff: {
        removedOrReplaced: [{ id: 't1', taskDate: '2026-10-10', description: '旧', status: 'pending' }],
        proposedPending: [{ taskDate: '2026-10-10', description: '新', status: 'pending' }],
        protectedKept: 3,
      },
    });
  },
}));

vi.mock('@/lib/modelPrefs', () => ({
  getModelPrefs: () => ({ strength: 'balanced' }),
}));

describe('plan adjustment preview SSE', () => {
  it('routes regenerate preview to onAdjustmentPreview, not draft preview', async () => {
    const seen: PlanStreamHandlers = {};
    const adjustment = vi.fn();
    const draftPreview = vi.fn();
    await streamPlanRegenerate(
      'plan-1',
      { message: '压缩阶段' },
      {
        onAdjustmentPreview: adjustment,
        onPreview: draftPreview,
        onStatus: () => undefined,
      },
    );
    expect(adjustment).toHaveBeenCalledOnce();
    expect(adjustment.mock.calls[0][0].id).toBe('adj-1');
    expect(adjustment.mock.calls[0][0].diff.protectedKept).toBe(3);
    expect(draftPreview).not.toHaveBeenCalled();
    void seen;
  });
});
