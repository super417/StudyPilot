import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import StatisticsWeeklyReview from '@/components/StatisticsWeeklyReview';
import type { WeeklyReview } from '@/mocks/types';

const sampleReview: WeeklyReview = {
  id: 'wr-1',
  weekStart: '2026-10-19',
  weekEnd: '2026-10-25',
  totalMinutes: 90,
  streakDays: 1,
  completionRate: 100,
  masteryAvg: 40,
  masteryDetail: [
    {
      phaseId: 'p1',
      subject: 'Python',
      percent: 40,
      evidenceCount: 2,
    },
  ],
};

function html(
  props: {
    review: WeeklyReview | null;
    empty: boolean;
    loading?: boolean;
    error?: string | null;
  },
): string {
  return renderToStaticMarkup(
    createElement(StatisticsWeeklyReview, {
      review: props.review,
      empty: props.empty,
      loading: props.loading ?? false,
      error: props.error ?? null,
    }),
  );
}

describe('StatisticsWeeklyReview（BP-02）', () => {
  it('区块标题为学习周报，并含双环与三指标区域', () => {
    const markup = html({ review: sampleReview, empty: false });
    expect(markup).toContain('学习周报');
    expect(markup).toContain('知识掌握');
    expect(markup).toContain('累计投入');
    expect(markup).toContain('90m');
    expect(markup).toContain('连续天数');
    expect(markup).toContain('任务完成率');
    // PurpleRing 圆心数字靠客户端 spring，SSR 初始为 0；真实值在 aria-label
    expect(markup).toContain('知识掌握平均值 40%');
  });

  it('无证据时空态不显示 0%，三指标显示暂无数据', () => {
    const markup = html({ review: null, empty: true });
    expect(markup).toContain('学习周报');
    expect(markup).toContain('暂无数据');
    expect(markup).toContain('暂无证据');
    expect(markup).toContain('本周期暂无掌握度证据');
    expect(markup).not.toContain('知识掌握平均值 0%');
  });
});
