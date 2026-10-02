import { apiRequest } from './httpClient';
import type { DailyTask, DailyTaskStatus, Metrics, TodayStatus } from '@/mocks/types';

export interface OverviewMetricsResponse {
  status: string;
  totalMinutes: number;
  streakDays: number;
  remainingDays: number;
  phaseProgress: { completed: number; total: number };
  todayStatus: TodayStatus;
}

export interface DailyTasksResponse {
  status: string;
  tasks: DailyTask[];
}

export interface CheckInResponse {
  status: string;
  checkInId: string;
}

export interface TaskStatusResponse {
  status: string;
  task: { id: string; status: DailyTaskStatus };
  phase: { id: string; progressPercent: number };
}

export function fetchOverviewMetrics(today: string): Promise<OverviewMetricsResponse> {
  return apiRequest<OverviewMetricsResponse>(
    `/api/metrics/overview?today=${encodeURIComponent(today)}`,
  );
}

export function toMetrics(res: OverviewMetricsResponse): Metrics {
  return {
    totalMinutes: res.totalMinutes,
    streakDays: res.streakDays,
    remainingDays: res.remainingDays,
    phaseProgress: res.phaseProgress,
    todayStatus: res.todayStatus,
  };
}

export function fetchDailyTasks(date: string): Promise<DailyTasksResponse> {
  return apiRequest<DailyTasksResponse>(
    `/api/daily-tasks?date=${encodeURIComponent(date)}`,
  );
}

/** 并行拉取多日任务（Roadmap 周视图；后端仅支持单日查询）。 */
export async function fetchDailyTasksForDates(dates: string[]): Promise<DailyTask[]> {
  const results = await Promise.all(dates.map((d) => fetchDailyTasks(d)));
  return results.flatMap((r) => r.tasks);
}

export function createCheckIn(input: {
  checkDate: string;
  durationMinutes: number;
  difficulty: number;
  energy: number;
  note?: string;
}): Promise<CheckInResponse> {
  return apiRequest<CheckInResponse>('/api/check-ins', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function setDailyTaskStatus(
  taskId: string,
  status: DailyTaskStatus,
): Promise<TaskStatusResponse> {
  return apiRequest<TaskStatusResponse>(`/api/daily-tasks/${taskId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}
