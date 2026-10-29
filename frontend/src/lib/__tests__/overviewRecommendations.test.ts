import { describe, expect, it } from 'vitest';
import { buildPostcardsOverview, weakestEvidence, type PostcardsOverview } from '../postcardsOverview';
import { buildLearningInsights } from '../overviewInsights';
const pending = { id: 't', phaseId: 'p', taskDate: '2026-10-29', weekLabel: 'W44', description: '练习列表推导式', status: 'pending' as const };
const base: PostcardsOverview = { ready: true, error: null, plan: null, metrics: null, tasks: [pending], review: null, insights: [], pendingMistakeCount: 0, dueMistakeCount: 0, unavailable: [] };
const review = { id: 'w', weekStart: '2026-10-19', weekEnd: '2026-10-25', totalMinutes: 90, streakDays: 2, completionRate: 50, masteryAvg: 25, masteryDetail: [
  { subject: '无证据阶段', percent: null, evidenceCount: 0 },
  { subject: 'Python', phaseId: 'p', percent: 25, evidenceCount: 2 },
  { subject: 'SQL', phaseId: 'q', percent: 80, evidenceCount: 10 },
] };
describe('有依据的下一步与记录边界', () => {
  it('今日任务变化时建议与操作一起变化', () => {
    const card = buildPostcardsOverview(base).plans[0];
    expect(card.action).toBe('start');
    expect(card.features.join('')).toContain(pending.description);
    const completed = buildPostcardsOverview({ ...base, tasks: [{ ...pending, status: 'done' }] }).plans[0];
    expect(completed.action).toBe('tasks');
    expect(completed.features.join('')).toContain('可以到此结束');
  });
  it('到期记录优先但不提前安排未到期题', () => {
    const due = buildPostcardsOverview({ ...base, pendingMistakeCount: 3, dueMistakeCount: 1 });
    expect(due.plans[0].action).toBe('mistakes');
    expect(due.plans[0].reason).toContain('已到期');
    expect(buildPostcardsOverview({ ...base, pendingMistakeCount: 3 }).plans[0].action).toBe('start');
  });
  it('没有任务与读取失败有不同的事实、数字和操作', () => {
    const failed = buildPostcardsOverview({ ...base, unavailable: ['tasks'] }).plans[0];
    expect(failed.monthly).toBe('—');
    expect(failed.action).toBe('retry');
    expect(failed.features.join('')).toContain('读取失败');
    expect(buildPostcardsOverview({ ...base, tasks: [] }).plans[0].action).toBe('plan');
    expect(buildPostcardsOverview({ ...base, tasks: [{ ...pending, status: 'carried' }] }).plans[0].features.join('')).not.toContain('今日安排已完成');
  });
  it('不把上次已读取结果用于本次读取失败的推荐', () => {
    const result = buildPostcardsOverview({ ...base, review, unavailable: ['review', 'mistakes'], pendingMistakeCount: 3, dueMistakeCount: 1 });
    expect(result.plans[1].monthly).toBe('—');
    expect(result.plans[1].action).toBe('retry');
    expect(result.plans[2].monthly).toBe('—');
    expect(result.plans[2].features.join('')).not.toContain('暂无到期');
    expect(result.plans[0].action).toBe('start');
  });
  it('只比较有样本的阶段并显示周期、少量样本提示', () => {
    expect(weakestEvidence(review)?.phaseId).toBe('p');
    const card = buildPostcardsOverview({ ...base, review }).plans[1];
    expect(card.features.join('')).toContain('Python');
    expect(card.features.join('')).toContain('样本 2 条');
    expect(card.note).toContain(review.weekStart);
    expect(card.reason).toContain('样本较少');
  });
  it('周报模式的内容与今日模式分别取对应范围', () => {
    const today = buildPostcardsOverview({ ...base, review });
    const weekly = buildPostcardsOverview({ ...base, review }, 'weekly');
    expect(today.plans[0].features.join('')).toContain(pending.description);
    expect(weekly.plans[0].features.join('')).not.toContain(pending.description);
    expect(weekly.plans[0].action).toBe('weekly');
    expect(weekly.plans[2].features.join('')).toContain('90');
  });
  it('初始加载时不显示旧分数、也不推断学习中断', () => {
    const result = buildPostcardsOverview({ ...base, ready: false, review });
    expect(result.plans.map((card) => card.monthly)).toEqual(['—', '—', '—']);
    const insight = buildLearningInsights(null, [pending]);
    expect(insight[1].title).not.toContain('中断');
    expect(insight[0].body).toContain('分别保存');
  });
});
