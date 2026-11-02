import { apiRequest } from './httpClient';
import type {
  MasteryDetailItem,
  ReinforceOutcome,
  WeeklyReview,
} from '@/mocks/types';

export interface WeeklyReviewLatestResponse {
  status: string;
  review: {
    totalsSource?: "live" | "snapshot";
    weekStart: string;
    weekEnd: string;
    totalMinutes: number;
    streakDays: number;
    completionRate: number;
    masteryAvg: number;
    masteryDetail: MasteryDetailItem[];
    reinforceOutcomes?: ReinforceOutcome[];
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
      ([subject]) => ({
        subject,
        percent: null,
        evidenceCount: 0,
      }),
    );
  }

  return {
    id: review.weekStart,
    totalsSource: review.totalsSource,
    createdAt: review.createdAt,
    weekStart: review.weekStart,
    weekEnd: review.weekEnd,
    totalMinutes: review.totalMinutes,
    streakDays: review.streakDays,
    completionRate: review.completionRate,
    masteryAvg: review.masteryAvg,
    masteryDetail,
    reinforceOutcomes: Array.isArray(review.reinforceOutcomes)
      ? review.reinforceOutcomes
      : [],
  };
}

export function weeklyTotalsSourceLabel(review: Pick<WeeklyReview, 'totalsSource' | 'createdAt'>): string {
  if (review.totalsSource === 'live') return '时长、连续天数与完成率根据当前记录计算';
  if (review.totalsSource === 'snapshot') {
    const raw = review.createdAt || '';
    const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? raw : `${raw}Z`;
    const time = new Date(normalized);
    const label = Number.isNaN(time.getTime()) ? '时间未知' : time.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    return `当周打卡记录不可用，显示历史快照（生成于 ${label}）`;
  }
  return '统计来源未知';
}
