/**
 * 规划 SSE 会话态：追问 draftId、最近生成的 planId、当前查看计划、待确认预览、数据刷新世代。
 */
import { create } from 'zustand';
import type { PlanAdjustmentPreview } from '@/lib/plansApi';
import { useAssistantStore } from './assistantStore';

interface PlanSessionState {
  draftId: string | null;
  clarifyQuestion: string | null;
  awaitingConfirm: boolean;
  awaitingStart: boolean;
  lastPlanId: string | null;
  /** Roadmap 等页面当前加载/查看的计划，调整优先绑定此 id */
  activePlanId: string | null;
  pendingAdjustment: PlanAdjustmentPreview | null;
  /** 确认/撤销写入后递增，驱动 Roadmap 等同计划刷新 */
  planDataEpoch: number;
  /** 进入资料比较后，遗留的旧无资料草稿不能再由聊天确认。 */
  legacyDraftBlocked: boolean;
  /** 换话题后，下一次确认词只重述草稿，不落库。 */
  draftConfirmHeld: boolean;
  /** 开始日或草稿所属的会话。另一会话不接这份等待。 */
  boundConversationId: string | null;
  /** 正在等待开始日的那一份规划。 */
  startPlanId: string | null;
  /** 预览摘要只属于这个草稿。 */
  previewDraftId: string | null;
  previewSummary: string | null;
  setClarify: (draftId: string, question: string) => void;
  setPreview: (draftId: string, summary?: string) => void;
  clearClarify: () => void;
  blockLegacyDraft: () => void;
  releaseLegacyDraft: () => void;
  holdDraftConfirm: () => void;
  releaseDraftConfirm: () => void;
  setLastPlanId: (planId: string) => void;
  setActivePlanId: (planId: string | null) => void;
  askForStart: (planId: string) => void;
  setPendingAdjustment: (preview: PlanAdjustmentPreview) => void;
  clearPendingAdjustment: () => void;
  bumpPlanDataEpoch: () => void;
}

export const usePlanSessionStore = create<PlanSessionState>((set) => ({
  draftId: null,
  clarifyQuestion: null,
  awaitingConfirm: false,
  awaitingStart: false,
  lastPlanId: null,
  activePlanId: null,
  pendingAdjustment: null,
  planDataEpoch: 0,
  legacyDraftBlocked: false,
  draftConfirmHeld: false,
  boundConversationId: null,
  startPlanId: null,
  previewDraftId: null,
  previewSummary: null,
  setClarify: (draftId, question) =>
    set({
      draftId,
      clarifyQuestion: question,
      awaitingConfirm: false,
      draftConfirmHeld: false,
      boundConversationId: useAssistantStore.getState().activeId,
      awaitingStart: false,
      startPlanId: null,
    }),
  setPreview: (draftId, summary) =>
    set({
      draftId,
      clarifyQuestion: null,
      awaitingConfirm: true,
      draftConfirmHeld: false,
      boundConversationId: useAssistantStore.getState().activeId,
      previewDraftId: draftId,
      previewSummary: summary?.trim() ? summary.trim().slice(0, 180) : null,
      awaitingStart: false,
      startPlanId: null,
    }),
  clearClarify: () =>
    set({
      draftId: null,
      clarifyQuestion: null,
      awaitingConfirm: false,
      draftConfirmHeld: false,
      boundConversationId: null,
      previewDraftId: null,
      previewSummary: null,
    }),
  blockLegacyDraft: () =>
    set({
      legacyDraftBlocked: true,
      draftId: null,
      clarifyQuestion: null,
      awaitingConfirm: false,
      draftConfirmHeld: false,
      boundConversationId: null,
      previewDraftId: null,
      previewSummary: null,
    }),
  releaseLegacyDraft: () => set({ legacyDraftBlocked: false }),
  holdDraftConfirm: () => set({ draftConfirmHeld: true }),
  releaseDraftConfirm: () => set({ draftConfirmHeld: false }),
  setLastPlanId: (planId) => set({ lastPlanId: planId }),
  setActivePlanId: (planId) => set({ activePlanId: planId }),
  askForStart: (planId) =>
    set({
      awaitingStart: true,
      startPlanId: planId,
      draftId: null,
      clarifyQuestion: null,
      draftConfirmHeld: false,
      boundConversationId: useAssistantStore.getState().activeId,
    }),
  setPendingAdjustment: (preview) => set({ pendingAdjustment: preview }),
  clearPendingAdjustment: () => set({ pendingAdjustment: null }),
  bumpPlanDataEpoch: () => set((s) => ({ planDataEpoch: s.planDataEpoch + 1 })),
}));
