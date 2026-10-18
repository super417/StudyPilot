import { apiRequest } from './httpClient';
import type { DailyTask } from '@/mocks/types';

export interface PhaseDetailResponse {
  status: string;
  phaseId: string;
  phaseName: string;
  subtitle: string | null;
  dateRange: string;
  learningPlan: string;
  isCurrent: boolean;
  isCompleted: boolean;
  progressPercent: number;
  tasks: DailyTask[];
}

export function fetchPhaseDetail(phaseId: string): Promise<PhaseDetailResponse> {
  return apiRequest<PhaseDetailResponse>(
    `/api/phases/${encodeURIComponent(phaseId)}/detail`,
  );
}
