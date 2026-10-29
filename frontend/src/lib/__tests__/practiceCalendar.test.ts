import { describe, expect, it } from 'vitest';
import { calendarToday, practiceCalendarDays, practiceDayLabel } from '../practiceCalendar';
import type { StarDayItem } from '../statisticsApi';

describe('练习日历日期与指标口径', () => {
  it('北京时间零点取新的一天，不跟随浏览器时区', () => {
    expect(calendarToday(new Date('2026-10-28T16:01:00Z'))).toBe('2026-10-29');
    expect(calendarToday(new Date('2026-10-28T15:59:00Z'))).toBe('2026-10-28');
  });
  it('跨月与星期占位保持 30 个真实日期，按周一开始', () => {
    const days = practiceCalendarDays([], '2026-10-29');
    const dates = days.filter((day) => day !== null);
    expect(days.length % 7).toBe(0);
    expect(days.slice(0, 2)).toEqual([null, null]); // 9 月 30 日为周三
    expect(dates).toHaveLength(30);
    expect(dates[0]?.date).toBe('2026-09-30');
    expect(dates[29]?.date).toBe('2026-10-29');
    expect(dates.every((day) => day?.accuracy === null)).toBe(true);
  });
  it('依据接口日期窗口排列，不篡改旧快照；闰年跨月不漏日', () => {
    const item: StarDayItem = { date: '2024-03-01', answered: 1, accuracy: 50, star: 'blue' };
    const dates = practiceCalendarDays([item], '2026-10-29').filter((day) => day !== null);
    expect(dates[29]).toEqual(item);
    expect(dates.some((day) => day?.date === '2024-02-29')).toBe(true);
    expect(dates.some((day) => day?.date === '2026-10-29')).toBe(false);
  });
  it('部分掌握折算 50 分及零分均保留为得分，不称正确率', () => {
    for (const score of [0, 50]) {
      const label = practiceDayLabel({ date: '2026-10-29', answered: 1, accuracy: score, star: score ? 'blue' : 'gray' });
      expect(label).toContain(`练习证据得分 ${score} / 100`);
      expect(label).not.toContain('正确率');
      expect(label).not.toContain('暂无');
    }
    expect(practiceDayLabel({ date: '2026-10-29', answered: 0, accuracy: null, star: 'none' })).toContain('暂无练习证据');
  });
});
