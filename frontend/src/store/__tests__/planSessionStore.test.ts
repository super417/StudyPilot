import { beforeEach, describe, expect, it } from 'vitest';
import { usePlanSessionStore } from '@/store/planSessionStore';

describe('planSessionStore draft and start', () => {
  beforeEach(() => {
    usePlanSessionStore.setState({
      draftId: null,
      clarifyQuestion: null,
      awaitingConfirm: false,
      awaitingStart: false,
      startPlanId: null,
      draftConfirmHeld: false,
      previewDraftId: null,
      previewSummary: null,
    });
  });

  it('新草稿不继承旧计划的开始日等待', () => {
    usePlanSessionStore.setState({ awaitingStart: true, startPlanId: 'old-plan' });
    usePlanSessionStore.getState().setClarify('new-draft', '请补充你的当前基础');
    expect(usePlanSessionStore.getState().draftId).toBe('new-draft');
    expect(usePlanSessionStore.getState().awaitingStart).toBe(false);
    expect(usePlanSessionStore.getState().startPlanId).toBeNull();

    usePlanSessionStore.setState({ awaitingStart: true, startPlanId: 'old-plan' });
    usePlanSessionStore.getState().setPreview('newer-draft', '先学线性表');
    expect(usePlanSessionStore.getState().draftId).toBe('newer-draft');
    expect(usePlanSessionStore.getState().awaitingStart).toBe(false);
    expect(usePlanSessionStore.getState().startPlanId).toBeNull();
  });
});
