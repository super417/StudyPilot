import { apiRequest } from '@/lib/httpClient';
import type { DailyTask } from '@/mocks/types';

import type { CheerResponse, JourneyResponse, JourneyTask } from './types';

export function fetchJourney(input: {
  today: string;
  from?: string;
  to?: string;
}): Promise<JourneyResponse> {
  const params = new URLSearchParams({ today: input.today });
  if (input.from) params.set('from', input.from);
  if (input.to) params.set('to', input.to);
  return apiRequest<JourneyResponse>(`/api/journey?${params.toString()}`);
}

export function fetchJourneyCheer(input: {
  today: string;
  scope: 'week' | 'day';
  date?: string;
  exclude?: string[];
}): Promise<CheerResponse> {
  const params = new URLSearchParams({ today: input.today, scope: input.scope });
  if (input.date) params.set('date', input.date);
  if (input.exclude && input.exclude.length > 0) params.set('exclude', input.exclude.join(','));
  return apiRequest<CheerResponse>(`/api/journey/cheer?${params.toString()}`);
}

export function fetchJourneyTasks(date: string): Promise<JourneyTask[]> {
  return apiRequest<{ tasks: DailyTask[] }>(`/api/daily-tasks?date=${encodeURIComponent(date)}`).then(
    (body) =>
      (body.tasks ?? []).slice(0, 5).map((task) => ({
        id: task.id,
        description: task.description,
        status: task.status,
      })),
  );
}
