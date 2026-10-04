import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import MasteryDetail from '@/components/MasteryDetail';
import MetricsRow from '@/components/MetricsRow';
import MistakeDetail from '@/components/MistakeDetail';
import PurpleRing from '@/components/PurpleRing';
import MasteryOverviewCard from '@/components/overview/MasteryOverviewCard';
import WeeklyMetrics from '@/components/WeeklyMetrics';
import type { Metrics, Mistake } from '@/mocks/types';

const metrics: Metrics = {
  totalMinutes: 0,
  streakDays: 0,
  remainingDays: 1,
  phaseProgress: { completed: 0, total: 1 },
  todayStatus: '未反馈',
};

const mistake: Mistake = {
  id: 'm1',
  question: '题',
  myAnswer: '',
  whyWrong: '',
  correctUnderstanding: '',
  reviewStatus: 'pending',
};

function html(node: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(node);
}

describe('视觉系统与响应式', () => {
  it('主色、深底白字、紫环和大圆角出现在渲染结果里', () => {
    const theme = readFileSync(new URL('../../../tailwind.config.js', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
    expect(theme).toContain("brand: '#10B981'");
    expect(css).toContain('rounded-[32px]');
    expect(css).toContain('bg-brandDark text-white');

    const ring = html(createElement(PurpleRing, { percent: 40 }));
    expect(ring).toContain('#8B5CF6');

    const mastery = html(
      createElement(MasteryOverviewCard, {
        avg: 40,
        items: [{ subject: '高等数学', percent: 40 }],
      }),
    );
    expect(mastery).toContain('rounded-[28px]');
    expect(mastery).toContain('bg-purple');

    const detail = html(createElement(MasteryDetail, { items: [{ subject: '英语', percent: 10 }] }));
    expect(detail).toContain('bg-purple');

    const question = html(createElement(MistakeDetail, { mistake }));
    expect(question).toContain('bg-brandDark');
    expect(question).toContain('text-white');

    const row = html(createElement(MetricsRow, { metrics }));
    expect(row).toContain('card');
  });

  it('大屏多列、默认单列', () => {
    const overview = readFileSync(
      new URL('../../pages/OverviewPage.tsx', import.meta.url),
      'utf8',
    );
    const book = readFileSync(
      new URL('../../pages/MistakeBookPage.tsx', import.meta.url),
      'utf8',
    );
    for (const source of [overview, book]) {
      expect(source).toContain('grid-cols-1');
      expect(source).toContain('lg:grid-cols-3');
    }

    const weekly = html(createElement(WeeklyMetrics, { review: null }));
    expect(weekly).toContain('grid-cols-1');
    expect(weekly).toContain('sm:grid-cols-3');

    const row = html(createElement(MetricsRow, { metrics }));
    expect(row).toContain('lg:grid-cols-4');
  });
});
