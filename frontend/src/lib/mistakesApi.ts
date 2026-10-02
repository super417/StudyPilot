import { apiRequest } from './httpClient';
import type { Mistake, ReviewStatus } from '@/mocks/types';

export interface MistakesListResponse {
  status: string;
  pendingCount: number;
  mistakes: Array<{
    id: string;
    question: string;
    reviewStatus: ReviewStatus;
    createdAt: string;
  }>;
}

export interface MistakeDetailResponse {
  status: string;
  mistake: Mistake & { createdAt?: string };
}

export interface ReviewStatusResponse {
  status: string;
  mistake: { id: string; reviewStatus: ReviewStatus };
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

export function setMistakeReviewStatus(
  id: string,
  status: ReviewStatus,
): Promise<ReviewStatusResponse> {
  return apiRequest<ReviewStatusResponse>(`/api/mistakes/${id}/review-status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
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
  };
}
