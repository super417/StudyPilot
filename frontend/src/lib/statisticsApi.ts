import { apiRequest } from './httpClient';

export interface PhaseDistributionItem {
  name: string;
  count: number;
  percent: number;
}

export interface DailyActivityItem {
  date: string;
  count: number;
}

export interface MasteryDistribution {
  correct: number;
  partial: number;
  wrong: number;
}

export interface TopMistakeItem {
  name: string;
  count: number;
}

export interface StatisticsOverview {
  status: string;
  /** 用户当前最新计划 id；无计划则为 null */
  activePlanId: string | null;
  totalAnswered: number;
  studyDays: number;
  uploadedDocs: number;
  mistakeCount: number;
  phaseDistribution: PhaseDistributionItem[];
  dailyActivity: DailyActivityItem[];
  masteryDistribution: MasteryDistribution;
  topMistakes: TopMistakeItem[];
}

export function fetchStatisticsOverview(): Promise<StatisticsOverview> {
  return apiRequest<StatisticsOverview>('/api/statistics/overview');
}
