import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import PhaseRings from '@/components/PhaseRings';
import type { MasteryDetailItem } from '@/mocks/types';

function html(items: MasteryDetailItem[]): string {
  return renderToStaticMarkup(createElement(PhaseRings, { items }));
}

describe('PhaseRings', () => {
  it('掌握度为 null 时写暂无掌握度证据，不写 0%，也不写基于次数', () => {
    const markup = html([
      {
        subject: '阶段一',
        percent: null,
        evidenceCount: 0,
        completionRate: 67,
        taskDone: 2,
        taskTotal: 3,
      },
    ]);
    expect(markup).toContain('暂无掌握度证据');
    expect(markup).not.toContain('0%');
    expect(markup).not.toContain('基于');
  });

  it('完成度为 null 时写本周无任务', () => {
    const markup = html([
      {
        subject: '阶段一',
        percent: 40,
        evidenceCount: 1,
        completionRate: null,
        taskDone: 0,
        taskTotal: 0,
      },
    ]);
    expect(markup).toContain('本周无任务');
  });

  it('把完成度和掌握度的数字写进页面', () => {
    const markup = html([
      {
        subject: '阶段一',
        percent: 33,
        evidenceCount: 3,
        completionRate: 67,
        taskDone: 2,
        taskTotal: 3,
      },
    ]);
    expect(markup).toContain('67%');
    expect(markup).toContain('33%');
    expect(markup).toContain('2/3');
    expect(markup).toContain('基于 3 次作答');
  });

  it('证据条数取真实值，1 次也显示', () => {
    const one = html([
      {
        subject: '阶段一',
        percent: 100,
        evidenceCount: 1,
        completionRate: 50,
        taskDone: 1,
        taskTotal: 2,
      },
    ]);
    expect(one).toContain('基于 1 次作答');

    const missingCount = html([
      {
        subject: '阶段一',
        percent: 40,
        completionRate: 50,
        taskDone: 1,
        taskTotal: 2,
      },
    ]);
    expect(missingCount).toContain('掌握度 40%');
    expect(missingCount).not.toContain('基于');
  });

  it('背离时显示生成补强任务入口', () => {
    const markup = renderToStaticMarkup(
      createElement(PhaseRings, {
        items: [
          {
            subject: '阶段一',
            percent: 33,
            evidenceCount: 3,
            completionRate: 100,
            taskDone: 3,
            taskTotal: 3,
          },
        ],
        onRequestReinforce: () => undefined,
      }),
    );
    expect(markup).toContain('生成补强任务');
  });

  it('差距达到阈值才标出，任一为空则不标', () => {
    const marked = html([
      {
        subject: '阶段一',
        percent: 33,
        evidenceCount: 3,
        completionRate: 100,
        taskDone: 3,
        taskTotal: 3,
      },
    ]);
    expect(marked).toContain('完成度高于掌握度 67 点');
    expect(marked).toContain('基于 3 次作答');

    const quiet = html([
      {
        subject: '阶段一',
        percent: 50,
        evidenceCount: 2,
        completionRate: 70,
        taskDone: 7,
        taskTotal: 10,
      },
    ]);
    expect(quiet).not.toContain('完成度高于掌握度');

    const missingMastery = html([
      {
        subject: '阶段一',
        percent: null,
        evidenceCount: 0,
        completionRate: 100,
        taskDone: 3,
        taskTotal: 3,
      },
    ]);
    expect(missingMastery).not.toContain('完成度高于掌握度');

    const missingCompletion = html([
      {
        subject: '阶段一',
        percent: 10,
        evidenceCount: 1,
        completionRate: null,
        taskDone: 0,
        taskTotal: 0,
      },
    ]);
    expect(missingCompletion).not.toContain('完成度高于掌握度');
  });
});
