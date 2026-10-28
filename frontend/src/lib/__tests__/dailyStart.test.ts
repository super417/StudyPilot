import { describe, expect, it } from 'vitest';
import { buildDailyStartPrompt, MICRO_TASKS } from '../dailyStart';
import type { DailyTask } from '@/mocks/types';

const tasks: DailyTask[] = [
  { id: 'a', phaseId: 'p', taskDate: '2026-10-27', weekLabel: 'W44', description: '练习列表推导式', status: 'pending' },
  { id: 'b', phaseId: 'p', taskDate: '2026-10-27', weekLabel: 'W44', description: '回顾二分查找', status: 'pending' },
  { id: 'done', phaseId: 'p', taskDate: '2026-10-27', weekLabel: 'W44', description: '已经完成的任务', status: 'done' },
];
describe('学习前确认本次任务量', () => {
  it('只带入选中的待完成任务、时间上限和继续前询问要求', () => {
    const prompt = buildDailyStartPrompt(15, tasks, ['b', 'done']);
    expect(prompt).toContain('本次可用 15 分钟');
    expect(prompt).toContain('以下 1 项');
    expect(prompt).toContain('回顾二分查找');
    expect(prompt).not.toContain('练习列表推导式');
    expect(prompt).not.toContain('已经完成的任务');
    expect(prompt).toContain('想继续时再问我');
    expect(prompt).toContain('不授权修改原规划');
  });
  it('支持多项选择，去掉重复与未知标识', () => {
    expect(buildDailyStartPrompt(45, tasks, ['a', 'a', 'b', 'missing'])).toContain('以下 2 项');
  });
  it.each([0, 4, 241, 15.5, Number.NaN])('拒绝无效时间 %s', (minutes) => {
    expect(() => buildDailyStartPrompt(minutes, tasks, ['a'])).toThrow();
  });
  it('不允许未选任务或使用已完成任务启动', () => {
    expect(() => buildDailyStartPrompt(30, tasks, [])).toThrow();
    expect(() => buildDailyStartPrompt(30, tasks, ['done'])).toThrow();
  });
  it('无待完成任务时明确标记自选练习，不冒充已保存任务', () => {
    const prompt = buildDailyStartPrompt(10, [], [], MICRO_TASKS[0]);
    expect(prompt).toContain('本次自选练习，不是已保存的每日任务');
  });
});
