/**
 * 规划 SSE 会话态：追问 draftId、最近生成的 planId。
 */
import { create } from 'zustand';

interface PlanSessionState {
  draftId: string | null;
  clarifyQuestion: string | null;
  lastPlanId: string | null;
  setClarify: (draftId: string, question: string) => void;
  clearClarify: () => void;
  setLastPlanId: (planId: string) => void;
}

export const usePlanSessionStore = create<PlanSessionState>((set) => ({
  draftId: null,
  clarifyQuestion: null,
  lastPlanId: null,
  setClarify: (draftId, question) => set({ draftId, clarifyQuestion: question }),
  clearClarify: () => set({ draftId: null, clarifyQuestion: null }),
  setLastPlanId: (planId) => set({ lastPlanId: planId }),
}));
