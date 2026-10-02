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
  handlers.onStatus?.('Agent：正在按你的说明重新生成规划…');
  return consumeSse({
    path: `/api/plans/${encodeURIComponent(planId)}/regenerate`,
    body: withReasoningStrength({ ...body }),
    signal,
    onEvent: (event, data) => dispatch(event, data, handlers),
  });
}

export interface LatestPlanResponse {
  status: string;
  empty?: boolean;
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
