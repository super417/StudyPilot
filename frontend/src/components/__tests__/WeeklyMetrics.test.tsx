import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import WeeklyMetrics from '@/components/WeeklyMetrics';

function html(
  review: {
    totalMinutes: number;
    streakDays: number;
    completionRate: number;
  } | null,
): string {
  return renderToStaticMarkup(createElement(WeeklyMetrics, { review }));
}

describe('WeeklyMetrics', () => {
  it('没有周报时显示暂无数据，不出现 0m 或 0%', () => {
    const markup = html(null);
    expect(markup).toContain('暂无数据');
    expect(markup).not.toContain('0m');
    expect(markup).not.toContain('0%');
  });

  it('有周报时显示真实数字，包括真实的 0', () => {
    const markup = html({ totalMinutes: 0, streakDays: 0, completionRate: 0 });
    expect(markup).toContain('0m');
    expect(markup).toContain('0%');
    expect(markup).not.toContain('暂无数据');
  });
});
