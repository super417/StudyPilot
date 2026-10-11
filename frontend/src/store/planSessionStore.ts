/**
 * 规划 SSE 会话态：追问 draftId、最近生成的 planId、当前查看计划、待确认预览、数据刷新世代。
 */
import { create } from 'zustand';
import type { PlanAdjustmentPreview } from '@/lib/plansApi';

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
  setClarify: (draftId: string, question: string) => void;
  setPreview: (draftId: string) => void;
  clearClarify: () => void;
  blockLegacyDraft: () => void;
  releaseLegacyDraft: () => void;
  setLastPlanId: (planId: string) => void;
  setActivePlanId: (planId: string | null) => void;
  askForStart: () => void;
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
  setClarify: (draftId, question) =>
    set({ draftId, clarifyQuestion: question, awaitingConfirm: false }),
  setPreview: (draftId) =>
    set({ draftId, clarifyQuestion: null, awaitingConfirm: true }),
  clearClarify: () =>
    set({ draftId: null, clarifyQuestion: null, awaitingConfirm: false }),
  blockLegacyDraft: () =>
    set({
      legacyDraftBlocked: true,
      draftId: null,
      clarifyQuestion: null,
      awaitingConfirm: false,
    }),
  releaseLegacyDraft: () => set({ legacyDraftBlocked: false }),
  setLastPlanId: (planId) => set({ lastPlanId: planId }),
  setActivePlanId: (planId) => set({ activePlanId: planId }),
  askForStart: () => set({ awaitingStart: true, draftId: null, clarifyQuestion: null }),
  setPendingAdjustment: (preview) => set({ pendingAdjustment: preview }),
  clearPendingAdjustment: () => set({ pendingAdjustment: null }),
  bumpPlanDataEpoch: () => set((s) => ({ planDataEpoch: s.planDataEpoch + 1 })),
}));
