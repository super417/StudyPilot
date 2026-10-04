import { apiRequest } from './httpClient';
import type { Mistake, ReviewStatus } from '@/mocks/types';

export interface MistakesListResponse {
  status: string;
  pendingCount: number;
  /** 已安排且下次复习时间已到的错题数 */
  dueCount?: number;
  mistakes: Array<{
    id: string;
    question: string;
    reviewStatus: ReviewStatus;
    nextReviewAt?: string | null;
    due?: boolean;
    createdAt: string;
  }>;
}

/** 到期的排最前，其余保持后端顺序（最新在前）。 */
export function dueFirst<T extends { due?: boolean }>(items: T[]): T[] {
  return [...items.filter((m) => m.due), ...items.filter((m) => !m.due)];
}

export type QueueFilter = 'all' | 'due' | 'pending' | 'scheduled' | 'done';

const FILTER_KEY = 'studypilot.mistakeFilter';
const FILTERS: QueueFilter[] = ['all', 'due', 'pending', 'scheduled', 'done'];

/** 切到错题本之前调用。页面还没挂载，所以先记下，挂载时取走。 */
export function requestMistakeFilter(filter: QueueFilter) {
  sessionStorage.setItem(FILTER_KEY, filter);
  window.dispatchEvent(new Event('studypilot:mistake-filter'));
}

export function takeMistakeFilter(): QueueFilter | null {
  const value = sessionStorage.getItem(FILTER_KEY);
  sessionStorage.removeItem(FILTER_KEY);
  return FILTERS.includes(value as QueueFilter) ? (value as QueueFilter) : null;
}

export function matchQueueFilter(
  mistake: { due?: boolean; reviewStatus: ReviewStatus },
  filter: QueueFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'due') return Boolean(mistake.due);
  return mistake.reviewStatus === filter;
}

/** 空关键词不过滤；否则原题包含关键词（忽略大小写）。 */
export function matchQuestion(question: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || question.toLowerCase().includes(q);
}

export interface MistakeDetailResponse {
  status: string;
  mistake: Mistake & { createdAt?: string };
}

export interface ReviewStatusResponse {
  status: string;
  mistake: { id: string; reviewStatus: ReviewStatus; nextReviewAt?: string | null };
}

/** POST /api/mistakes/ocr — 用设置里的识图模型把题目图片转成文字 */
export function recognizeQuestionImage(image: File): Promise<{ status: string; text: string }> {
  const form = new FormData();
  form.append('image', image);
  return apiRequest('/api/mistakes/ocr', { method: 'POST', body: form });
}

export function listMistakes(): Promise<MistakesListResponse> {
  return apiRequest<MistakesListResponse>('/api/mistakes');
}

export interface CreateMistakeInput {
  question: string;
  myAnswer?: string;
  whyWrong?: string;
  correctUnderstanding?: string;
}

export interface CreateMistakeResponse {
  status: string;
  mistake: Mistake & { createdAt?: string };
}

/** POST /api/mistakes — 手动录入错题 */
export function createMistake(
  input: CreateMistakeInput,
): Promise<CreateMistakeResponse> {
  return apiRequest<CreateMistakeResponse>('/api/mistakes', {
    method: 'POST',
    body: JSON.stringify({
      question: input.question,
      myAnswer: input.myAnswer || undefined,
      whyWrong: input.whyWrong || undefined,
      correctUnderstanding: input.correctUnderstanding || undefined,
    }),
  });
}

export function getMistake(id: string): Promise<MistakeDetailResponse> {
  return apiRequest<MistakeDetailResponse>(`/api/mistakes/${id}`);
}

/** PUT /api/mistakes/{id} — 改原题与解析字段 */
export function updateMistake(
  id: string,
  input: CreateMistakeInput,
): Promise<CreateMistakeResponse> {
  return apiRequest<CreateMistakeResponse>(`/api/mistakes/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      question: input.question,
      myAnswer: input.myAnswer || undefined,
      whyWrong: input.whyWrong || undefined,
      correctUnderstanding: input.correctUnderstanding || undefined,
    }),
  });
}

export function setMistakeReviewStatus(
  id: string,
  status: ReviewStatus,
): Promise<ReviewStatusResponse> {
  return apiRequest<ReviewStatusResponse>(`/api/mistakes/${id}/review-status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

/** DELETE /api/mistakes/{id} — 删除一条错题 */
export function deleteMistake(id: string): Promise<{ status: string; deletedId: string }> {
  return apiRequest(`/api/mistakes/${id}`, { method: 'DELETE' });
}

/** 列表项补全为 Mistake 展示形（详情字段待按需拉取）。 */
export function listItemToMistake(
  item: MistakesListResponse['mistakes'][number],
): Mistake {
  return {
    id: item.id,
    question: item.question,
    myAnswer: '',
    whyWrong: '',
    correctUnderstanding: '',
    reviewStatus: item.reviewStatus,
    nextReviewAt: item.nextReviewAt ?? undefined,
    due: item.due ?? false,
    createdAt: item.createdAt,
  };
}
