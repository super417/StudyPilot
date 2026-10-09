import { consumeSse, type SseData } from './sseClient';
import { getModelPrefs } from './modelPrefs';
import { apiRequest } from './httpClient';

export interface PlanGoalFields {
  goalName?: string;
  goalDate?: string;
  currentLevel?: string;
  dailyMinutes?: number;
  documentIds?: string[];
  reasoningStrength?: string;
  message?: string;
}

export interface PlanClarifyEvent {
  draftId: string;
  round: number;
  missing: string[];
  question: string;
}

export interface PlanNoticeEvent {
  message?: string;
  skippedDocs?: string[];
}

export interface PlanPreviewEvent {
  draftId: string;
  summary: string;
}

export interface PlanAdjustmentDiff {
  removedOrReplaced: Array<{
    id: string;
    taskDate: string;
    description: string;
    status: string;
  }>;
  proposedPending: Array<{
    taskDate: string;
    description: string;
    status: string;
  }>;
  protectedKept: number;
}

export interface PlanAdjustmentPreview {
  id: string;
  planId: string;
  status: string;
  instruction: string;
  diff: PlanAdjustmentDiff;
  validation: Record<string, unknown>;
  steps: Array<Record<string, unknown>>;
  decisionSummary: string;
  evidenceRefs: unknown[];
  summary: string;
  phases: number;
  usedDocs: string[];
}

export interface PlanDoneEvent {
  planId: string;
  phases: number;
  usedDocs: string[];
}

export interface PlanErrorEvent {
  code: string;
  message: string;
}

export interface PlanStreamHandlers {
  onClarify?: (data: PlanClarifyEvent) => void;
  onNotice?: (data: PlanNoticeEvent) => void;
  onPreview?: (data: PlanPreviewEvent) => void;
  onAdjustmentPreview?: (data: PlanAdjustmentPreview) => void;
  onDone?: (data: PlanDoneEvent) => void;
  onError?: (data: PlanErrorEvent) => void;
  /** Agent 阶段文案，如「正在调用学习规划工具…」 */
  onStatus?: (text: string) => void;
}

function asClarify(data: SseData): PlanClarifyEvent {
  return {
    draftId: String(data.draftId ?? ''),
    round: Number(data.round ?? 0),
    missing: Array.isArray(data.missing) ? data.missing.map(String) : [],
    question: String(data.question ?? ''),
  };
}

function asDone(data: SseData): PlanDoneEvent {
  return {
    planId: String(data.planId ?? ''),
    phases: Number(data.phases ?? 0),
    usedDocs: Array.isArray(data.usedDocs) ? data.usedDocs.map(String) : [],
  };
}

function asError(data: SseData): PlanErrorEvent {
  return {
    code: String(data.code ?? 'PLAN_ERROR'),
    message: String(data.message ?? '规划失败，请稍后重试'),
  };
}

function asNotice(data: SseData): PlanNoticeEvent {
  return {
    message: data.message != null ? String(data.message) : undefined,
    skippedDocs: Array.isArray(data.skippedDocs)
      ? data.skippedDocs.map(String)
      : undefined,
  };
}

function dispatch(event: string, data: SseData, handlers: PlanStreamHandlers) {
  switch (event) {
    case 'clarify':
      handlers.onStatus?.('Agent：信息不足，正在追问补充…');
      handlers.onClarify?.(asClarify(data));
      break;
    case 'preview': {
      handlers.onStatus?.('Agent：路线已整理，等你确认');
      if (data.id && data.planId && data.diff) {
        const diff = data.diff as Record<string, unknown>;
        handlers.onAdjustmentPreview?.({
          id: String(data.id),
          planId: String(data.planId),
          status: String(data.status ?? 'pending'),
          instruction: String(data.instruction ?? ''),
          diff: {
            removedOrReplaced: Array.isArray(diff.removedOrReplaced)
              ? (diff.removedOrReplaced as PlanAdjustmentDiff['removedOrReplaced'])
              : [],
            proposedPending: Array.isArray(diff.proposedPending)
              ? (diff.proposedPending as PlanAdjustmentDiff['proposedPending'])
              : [],
            protectedKept: Number(diff.protectedKept ?? 0),
          },
          validation: (data.validation as Record<string, unknown>) ?? {},
          steps: Array.isArray(data.steps)
            ? (data.steps as Array<Record<string, unknown>>)
            : [],
          decisionSummary: String(data.decisionSummary ?? data.summary ?? ''),
          evidenceRefs: Array.isArray(data.evidenceRefs) ? data.evidenceRefs : [],
          summary: String(data.summary ?? data.decisionSummary ?? ''),
          phases: Number(data.phases ?? 0),
          usedDocs: Array.isArray(data.usedDocs) ? data.usedDocs.map(String) : [],
        });
      } else {
        handlers.onPreview?.({
          draftId: String(data.draftId ?? ''),
          summary: String(data.summary ?? ''),
        });
      }
      break;
    }
    case 'notice':
      handlers.onStatus?.('Agent：正在处理规划依据 / 就绪性检查…');
      handlers.onNotice?.(asNotice(data));
      break;
    case 'done':
      handlers.onStatus?.('Agent：规划已生成');
      handlers.onDone?.(asDone(data));
      break;
    case 'error':
      handlers.onError?.(asError(data));
      break;
    default:
      break;
  }
}

function withReasoningStrength<T extends Record<string, unknown>>(body: T): T & { reasoningStrength: string } {
  return { ...body, reasoningStrength: getModelPrefs().strength };
}

export function streamPlanGenerate(
  fields: PlanGoalFields,
  handlers: PlanStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  handlers.onStatus?.('Agent：正在调用学习规划工具…');
  return consumeSse({
    path: '/api/plans/generate',
    body: withReasoningStrength({ ...fields }),
    signal,
    onEvent: (event, data) => dispatch(event, data, handlers),
  });
}

export function streamPlanClarify(
  draftId: string,
  fields: PlanGoalFields,
  handlers: PlanStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  handlers.onStatus?.('Agent：正在根据补充信息继续规划…');
  return consumeSse({
    path: `/api/plans/${encodeURIComponent(draftId)}/clarify`,
    body: withReasoningStrength({ ...fields }),
    signal,
    onEvent: (event, data) => dispatch(event, data, handlers),
  });
}

export function streamPlanRegenerate(
  planId: string,
  body: PlanGoalFields & { message: string },
  handlers: PlanStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  handlers.onStatus?.('Agent：正在按你的说明生成调整预览…');
  return consumeSse({
    path: `/api/plans/${encodeURIComponent(planId)}/regenerate`,
    body: withReasoningStrength({ ...body }),
    signal,
    onEvent: (event, data) => dispatch(event, data, handlers),
  });
}

export function confirmPlanAdjustment(planId: string, adjustmentId: string) {
  return apiRequest<{ status: string; adjustment: { decisionSummary?: string; status: string } }>(
    `/api/plans/${encodeURIComponent(planId)}/adjustments/${encodeURIComponent(adjustmentId)}/confirm`,
    { method: 'POST' },
  ).then((body) => body.adjustment);
}

export function rejectPlanAdjustment(planId: string, adjustmentId: string) {
  return apiRequest<{ status: string; adjustment: { status: string } }>(
    `/api/plans/${encodeURIComponent(planId)}/adjustments/${encodeURIComponent(adjustmentId)}/reject`,
    { method: 'POST' },
  ).then((body) => body.adjustment);
}

export function undoPlanAdjustment(planId: string) {
  return apiRequest<{ status: string; adjustment: { decisionSummary?: string; status: string } }>(
    `/api/plans/${encodeURIComponent(planId)}/adjustments/undo`,
    { method: 'POST' },
  ).then((body) => body.adjustment);
}

export function planStartQuestion(today = new Date()): string {
  const iso = (day: Date) => {
    const month = String(day.getMonth() + 1).padStart(2, '0');
    const date = String(day.getDate()).padStart(2, '0');
    return `${day.getFullYear()}-${month}-${date}`;
  };
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  return [
    '规划好了。你希望从哪天开始？阶段和每天的任务都会从这一天排起。',
    `· 回「今天」→ ${iso(today)}`,
    `· 回「明天」→ ${iso(tomorrow)}`,
    '· 也可以直接说日期，比如「10月8日」',
  ].join('\n');
}

/** 把最新规划的第一天改成用户刚说的那天。 */
export function setPlanStart(message: string) {
  return apiRequest<{ status: string; startDate: string }>('/api/plans/start', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export interface LatestPlanResponse {
  status: string;
  empty?: boolean;
  needsStartDate?: boolean;
  plan: {
    id: string;
    goalName: string;
    subtitle: string;
    startDate: string;
    goalDate: string;
    currentLevel: string;
    dailyMinutes: number;
    totalPhases: number;
    updatedAt: string;
  } | null;
  phases: Array<{
    id: string;
    phaseIndex: number;
    name: string;
    startDate: string;
    endDate: string;
    progressPercent: number;
    isCurrent: boolean;
    isCompleted: boolean;
  }>;
}

/** GET /api/plans/latest — 最新规划 + 阶段列表 */
export function fetchLatestPlan(): Promise<LatestPlanResponse> {
  return apiRequest<LatestPlanResponse>('/api/plans/latest');
}

export interface PhasePatch {
  name?: string;
  startDate?: string;
  endDate?: string;
}

/** PATCH /api/phases/{id} — 只改这一阶段的名称和日期。 */
export function patchPhase(phaseId: string, patch: PhasePatch) {
  return apiRequest<{ status: string; phase: LatestPlanResponse['phases'][number] }>(
    `/api/phases/${phaseId}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
}
