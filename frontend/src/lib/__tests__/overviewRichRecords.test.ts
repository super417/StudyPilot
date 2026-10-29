import { describe, expect, it } from 'vitest';
import { buildPostcardsOverview, type PostcardsOverview } from '../postcardsOverview';
const data: PostcardsOverview = {
  ready: true, error: null, unavailable: [], insights: [],
  plan: { id: 'p', goalName: '真实学习目标', startDate: '2026-10-01', goalDate: '2026-12-31', subtitle: '', currentLevel: '', dailyMinutes: 45, totalPhases: 3, updatedAt: '2026-10-29', completionCriterion: '独立完成数据分析报告' },
  metrics: { totalMinutes: 180, streakDays: 3, remainingDays: 63, phaseProgress: { completed: 1, total: 3 }, todayStatus: '已安排' },
  tasks: [{ id: 't1', phaseId: 'p1', taskDate: '2026-10-29', weekLabel: 'W44', description: '今日列表练习', status: 'pending' }, { id: 't2', phaseId: 'p1', taskDate: '2026-10-29', weekLabel: 'W44', description: '已完成的原题', status: 'done' }],
  review: { id: 'w', weekStart: '2026-10-19', weekEnd: '2026-10-25', totalMinutes: 90, streakDays: 2, completionRate: 75, masteryAvg: 50, masteryDetail: [
    { phaseId: 'p1', subject: 'Python循环', percent: 25, evidenceCount: 2, taskDone: 1, taskTotal: 2, completionRate: 50 },
    { phaseId: 'p2', subject: 'SQL查询', percent: 75, evidenceCount: 12 },
    { phaseId: 'p3', subject: '待评估内容', percent: null, evidenceCount: 0 },
  ] }, pendingMistakeCount: 0, dueMistakeCount: 0,
};
describe('三卡使用真实记录形成不同的内容长度', () => {
  it('今日安排6–8条、评估和常用零队列复盘6–7条，保留实际样本和目标', () => {
    const cards = buildPostcardsOverview(data).plans;
    expect(cards[0].features.length).toBeGreaterThanOrEqual(6);
    expect(cards[0].features.length).toBeLessThanOrEqual(8);
    for (const card of cards.slice(1)) {
      expect(card.features.length).toBeGreaterThanOrEqual(6);
      expect(card.features.length).toBeLessThanOrEqual(7);
    }
    expect(cards[0].features.join('')).toContain('45 分钟');
    expect(cards[1].features.join('')).toContain('14 条练习证据');
    expect(cards[1].features.join('')).toContain('SQL查询：证据得分 75%，样本 12 条');
    expect(cards[1].features.join('')).toContain('勾选任务不直接提高分数');
    expect(cards[2].features.join('')).toContain('独立完成数据分析报告');
    expect(cards[2].features.join('')).toContain('用户自报');
    expect(cards[2].features.join('')).toContain('14 条练习证据');
    expect(cards[2].features.join('')).toContain('可以结束');
  });
  it('展示真实错因和理解，待安排与到期并列而非错误相减', () => {
    const result = buildPostcardsOverview({ ...data, pendingMistakeCount: 1, dueMistakeCount: 3, featuredMistake: { id: 'm', question: '原始列表题', myAnswer: '', whyWrong: '遗漏边界值', correctUnderstanding: '先判断空列表', reviewStatus: 'scheduled', due: true } });
    const text = result.plans[2].features.join('');
    expect(text).toContain('1 题待安排复习，另有 3 题');
    expect(text).toContain('原始列表题');
    expect(text).toContain('遗漏边界值');
    expect(text).toContain('先判断空列表');
    expect(text).not.toMatch(/-\d+\s*题/);
    expect(result.plans[2].features[result.plans[2].features.length - 1]).toContain('下一步');
  });
  it('仅实际未到期题展示下次时间，不伪造缺失错因或展示已复习题为待办', () => {
    const featured = { id: 'm', question: '未来复习的原题', myAnswer: '', whyWrong: '', correctUnderstanding: '', reviewStatus: 'scheduled' as const, nextReviewAt: '2026-11-01T08:00:00Z', due: false };
    const text = buildPostcardsOverview({ ...data, featuredMistake: featured }).plans[2].features.join('');
    expect(text).toContain('2026-11-01T08:00:00Z');
    expect(text).not.toContain('记录的错因');
    const done = buildPostcardsOverview({ ...data, featuredMistake: { ...featured, reviewStatus: 'done' } });
    expect(done.plans[2].features.join('')).not.toContain(featured.question);
  });
  it('周报模式只展开对应周期，不混入当前任务、队列或目标标准', () => {
    const cards = buildPostcardsOverview(data, 'weekly').plans;
    expect(cards[0].features.join('')).toContain('1/2');
    for (const card of cards.slice(1)) {
      expect(card.features.length).toBeGreaterThanOrEqual(6);
      expect(card.features.length).toBeLessThanOrEqual(7);
    }
    const historical = cards.flatMap((card) => card.features).join('');
    expect(historical).not.toContain('今日列表练习');
    expect(historical).not.toContain('独立完成数据分析报告');
    expect(cards[2].features.join('')).toContain('2026-10-19 至 2026-10-25');
    expect(cards[2].features.join('')).toContain('截至周报周期末连续打卡 2 天');
  });
  it('读取失败及加载中不泄漏旧目标、任务、周报或原题', () => {
    for (const failed of [{ ready: false, unavailable: [] }, { ready: true, unavailable: ['plan', 'metrics', 'tasks', 'review', 'mistakes'] }, { ready: true, error: '整体失败', unavailable: [] }]) {
      const result = buildPostcardsOverview({ ...data, ...failed, featuredMistake: { id: 'm', question: '旧题秘密', myAnswer: '', whyWrong: '旧错因', correctUnderstanding: '', reviewStatus: 'pending' } });
      const text = JSON.stringify(result);
      for (const old of ['真实学习目标', '今日列表练习', '独立完成数据分析报告', '旧题秘密', '旧错因', 'SQL查询', '180']) expect(text).not.toContain(old);
      expect(result.plans.map((card) => card.monthly)).toEqual(['—', '—', '—']);
    }
  });
  it('空态允许自然短卡，不补造历史和示例题', () => {
    const result = buildPostcardsOverview({ ...data, plan: null, metrics: null, tasks: [], review: null });
    expect(result.plans[1].monthly).toBe('—');
    expect(result.plans[1].features.join('')).toContain('先完成一个小练习');
    expect(result.plans[2].features.length).toBeLessThan(5);
    expect(result.plans[2].features.join('')).not.toContain('最近周报');
  });
});
