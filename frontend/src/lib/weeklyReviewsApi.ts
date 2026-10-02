import { apiRequest } from './httpClient';
import type { MasteryDetailItem, WeeklyReview } from '@/mocks/types';

export interface WeeklyReviewLatestResponse {
  status: string;
  review: {
    weekStart: string;
    weekEnd: string;
    totalMinutes: number;
    streakDays: number;
    completionRate: number;
    masteryAvg: number;
    masteryDetail: MasteryDetailItem[];
    createdAt: string;
  } | null;
  empty?: boolean;
}

export function fetchLatestWeeklyReview(): Promise<WeeklyReviewLatestResponse> {
  return apiRequest<WeeklyReviewLatestResponse>('/api/weekly-reviews/latest');
}

export function toWeeklyReview(
  review: NonNullable<WeeklyReviewLatestResponse['review']>,
): WeeklyReview {
  const raw = review.masteryDetail as unknown;
  let masteryDetail: MasteryDetailItem[] = [];
  if (Array.isArray(raw)) {
    masteryDetail = raw as MasteryDetailItem[];
  } else if (raw && typeof raw === 'object') {
    masteryDetail = Object.entries(raw as Record<string, unknown>).map(
      ([subject, percent]) => ({
        subject,
        percent: Number(percent) || 0,
      }),
    );
  }

  return {
    id: review.weekStart,
    weekStart: review.weekStart,
    weekEnd: review.weekEnd,
    totalMinutes: review.totalMinutes,
    streakDays: review.streakDays,
    completionRate: review.completionRate,
    masteryAvg: review.masteryAvg,
    masteryDetail,
  };
}
