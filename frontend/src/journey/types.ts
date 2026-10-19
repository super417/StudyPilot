import type { StarColor } from './stars';

export type JourneyState = 'past' | 'today' | 'future' | 'empty';

export type JourneyTag = 'boss' | 'reinforce' | 'carried';

export interface JourneyPlan {
  id: string;
  goalName: string;
  startDate: string;
  goalDate: string;
}

export interface JourneyPhase {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  index: number;
}

export interface JourneyDay {
  date: string;
  total: number;
  done: number;
  carried: number;
  pending: number;
  rate: number | null;
  stars: number | null;
  accuracy: number | null;
  starColor: StarColor | null;
  hasCheckIn: boolean;
  minutes: number;
  tags: JourneyTag[];
  state: JourneyState;
  /** 接口没返回这一天时为 false，只占位，不编造星。 */
  loaded?: boolean;
}

export interface JourneySummary {
  streakDays: number;
  bestStreak: number;
  fullClearStreak: number;
  weekStars: number;
  lastWeekSameSpanStars: number;
}

export interface JourneyResponse {
  status: string;
  plan: JourneyPlan | null;
  phases: JourneyPhase[];
  today: string;
  days: JourneyDay[];
  summary: JourneySummary;
}

export interface JourneyTask {
  id: string;
  description: string;
  status: 'pending' | 'done' | 'carried';
}

export interface CheerResponse {
  ruleId: string;
  text: string;
  facts: Record<string, number | string>;
  source: 'template' | 'llm';
  /** 只给入口，本页不改计划。 */
  suggestRoadmap?: boolean;
}
