import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GoalCard from '../GoalCard';
import WeekCalendar from '../WeekCalendar';
import type { Plan } from '@/mocks/types';

afterEach(() => vi.useRealTimers());
describe('真实日期默认值', () => {
  it('目标进度使用当天而不是开始后的固定第八天', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 1, 12));
    const plan = { id: 'date-test', goalName: '目标', startDate: '2026-10-01', goalDate: '2026-11-01', subtitle: '' } as Plan;
    expect(renderToStaticMarkup(createElement(GoalCard, { plan }))).toContain('目标期限进度 100.0%');
  });
  it('跨月周日高亮真实今天', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 1, 12));
    const html = renderToStaticMarkup(createElement(WeekCalendar));
    expect(html).toContain('10-26');
    expect(html).toContain('11-01');
    expect(html).not.toContain('09-23');
    expect(html.match(/aria-current="date"/g)).toHaveLength(1);
  });
});
