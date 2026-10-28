import { describe, expect, it } from 'vitest';
import type { DailyTask } from '@/mocks/types';
import { buildDailyStartPrompt, dailyStartChoices, dailyStartSummary, MICRO_TASKS } from '../dailyStart';

const task = (id: string, taskDate: string, status: DailyTask['status'] = 'pending'): DailyTask => ({
  id, taskDate, status, phaseId: 'phase', weekLabel: 'W44', description: `学习 ${id}：完成练习并解释结果`,
});

describe('学习前从线路挑选任务', () => {
  it('包含非今日任务，今日优先，其余按原日期排列并排除已完成与已结转记录', () => {
    const input = [task('future', '2026-11-01'), task('done', '2026-10-28', 'done'), task('old', '2026-10-27'), task('today', '2026-10-28'), task('carried', '2026-10-26', 'carried')];
    expect(dailyStartChoices(input, '2026-10-28').map((item) => item.id)).toEqual(['today', 'old', 'future']);
    expect(input[0].id).toBe('future');
    expect(input[0].taskDate).toBe('2026-11-01');
  });
  it('多阶段重复任务只显示一次', () => {
    const item = task('a', '2026-10-28');
    expect(dailyStartChoices([item, item], '2026-10-28')).toHaveLength(1);
  });
  it('仅展示主内容摘要，但助手仍收到所选任务完整要求', () => {
    const item = { ...task('numpy', '2026-11-01'), description: 'NumPy 统计：对 5×3 成绩矩阵用 mean/std/sum 分别计算 axis=0 与 axis=1 的结果，写出一句说明' };
    expect(dailyStartSummary(item.description)).toBe('NumPy 统计');
    expect(buildDailyStartPrompt(30, [item], [item.id])).toContain(item.description);
    expect(dailyStartSummary('这是一段很长的没有标点的任务要求'.repeat(10)).length).toBeLessThanOrEqual(36);
  });
  it('兜底练习也支持多选或全部取消，取消后不能开始', () => {
    expect(buildDailyStartPrompt(30, [], [], [MICRO_TASKS[0], MICRO_TASKS[2]])).toContain('以下 2 项');
    expect(() => buildDailyStartPrompt(30, [], [], [])).toThrow('请至少选择一项');
  });
});
