import { describe, expect, it } from 'vitest';
import { buildPostcardsOverview, type PostcardsOverview } from '../postcardsOverview';

const base: PostcardsOverview = { ready: true, error: null, plan: null, metrics: { totalMinutes: 90, streakDays: 1, remainingDays: 65, phaseProgress: { completed: 1, total: 4 }, todayStatus: '已安排' }, tasks: [
  { id: 'a', phaseId: 'p', taskDate: '2026-10-27', weekLabel: 'W44', description: '我的真实任务', status: 'pending' },
  { id: 'b', phaseId: 'p', taskDate: '2026-10-27', weekLabel: 'W44', description: '完成的练习', status: 'done' },
], review: null, insights: [], pendingMistakeCount: 3, dueMistakeCount: 1, unavailable: [] };
describe('总览内容接入明信片页面', () => {
  it('读取实际任务与指标，缺少周报时不伪造掌握度', () => {
    const content = buildPostcardsOverview(base);
    expect(content.stats.map(([value]) => value)).toEqual(['65', '90', '1', '1/4']);
    expect(content.plans.map((plan) => plan.monthly)).toEqual(['1', '—', '3']);
    expect(content.plans[0].features.join('')).toContain('我的真实任务');
  });
  it('把没有读到的数据和真实零值区分开', () => {
    const unavailable = buildPostcardsOverview({ ...base, tasks: [], pendingMistakeCount: 0, unavailable: ['tasks', 'mistakes'] });
    expect(unavailable.plans[0].monthly).toBe('—');
    expect(unavailable.plans[2].monthly).toBe('—');
    const empty = buildPostcardsOverview({ ...base, tasks: [], pendingMistakeCount: 0 });
    expect(empty.plans[0].monthly).toBe('0');
    expect(empty.plans[2].monthly).toBe('0');
  });
  it('最近周报切换使用真实周期数据，零条证据不显示伪零分', () => {
    const data = { ...base, review: { id: 'w', weekStart: '2026-10-19', weekEnd: '2026-10-25', totalMinutes: 75, streakDays: 1, completionRate: 60, masteryAvg: 0, masteryDetail: [{ subject: 'Python', percent: null, evidenceCount: 0 }] } };
    const content = buildPostcardsOverview(data);
    expect(content.plans[0].annual).toBe('60%');
    expect(content.plans[2].annual).toBe('75');
    expect(content.plans[1].monthly).toBe('—');
  });
});
