import { apiRequest } from './httpClient';

export interface PhaseDistributionItem {
  name: string;
  count: number;
  percent: number;
}

export interface DailyActivityItem {
  date: string;
  count: number;
  /**
   * 按掌握度结果拆开的当日作答量，三段之和等于 count。
   * 可选：老后端/测试替身不返回时按 0 处理。
   */
  correct?: number;
  partial?: number;
  wrong?: number;
  /** 当天新收录的错题数（独立指标，不是 count 的子集） */
  mistakes?: number;
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

export interface StarDayItem {
  date: string;
  answered: number;
  accuracy: number | null;
  star: 'gold' | 'blue' | 'gray' | 'none';
}

export interface RoutePhaseItem {
  phaseId: string;
  name: string;
  index: number;
  startDate: string;
  endDate: string;
  progress: number;
  isCurrent: boolean;
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
  stars: StarDayItem[];
  route: RoutePhaseItem[];
  overdueCount: number;
  todayTasksDone: number;
  todayTasksTotal: number;
}

export function fetchStatisticsOverview(): Promise<StatisticsOverview> {
  return apiRequest<StatisticsOverview>('/api/statistics/overview');
}

export interface PracticeDayDetail {
  status: 'ok';
  date: string;
  timezone: 'Asia/Shanghai';
  answered: number;
  score: number | null;
  distribution: MasteryDistribution;
  total: number;
  truncated: boolean;
  evidence: Array<{ id: string; result: keyof MasteryDistribution; phaseName: string | null; gradeReason: string | null; errorTag: string | null }>;
}

export function fetchPracticeDay(day: string, signal?: AbortSignal): Promise<PracticeDayDetail> {
  return apiRequest(`/api/statistics/practice-days/${encodeURIComponent(day)}`, { signal });
}

export interface DiagnosisReport {
  id: string;
  title?: string;
  content: string;
  generatedAt: string;
  evidence: {
    totalAnswered: number;
    rangeStart: string;
    rangeEnd: string;
    sampleCount: number;
    distribution: MasteryDistribution;
  };
}

export function fetchLatestDiagnosis(): Promise<{ report: DiagnosisReport | null }> {
  return apiRequest('/api/statistics/diagnosis/latest');
}

export function fetchDiagnosisHistory(): Promise<{ reports: DiagnosisReport[] }> {
  return apiRequest('/api/statistics/diagnosis/history');
}

export function generateDiagnosis(): Promise<{ report: DiagnosisReport }> {
  return apiRequest('/api/statistics/diagnosis', { method: 'POST' });
}
