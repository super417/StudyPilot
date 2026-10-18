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

  it('有补强任务的阶段显示 overall；after 无证据写尚未重测而不是 0%；不挂重测按钮', () => {
    const phaseId = 'phase-a';
    const markup = renderToStaticMarkup(
      createElement(PhaseRings, {
        items: [
          {
            subject: '阶段一',
            phaseId,
            percent: 40,
            evidenceCount: 2,
            completionRate: 100,
            taskDone: 2,
            taskTotal: 2,
          },
        ],
        reinforceOutcomesByPhase: {
          [phaseId]: {
            phaseId,
            overall: { percent: 40, evidenceCount: 2 },
            before: { percent: 40, evidenceCount: 2 },
            after: { percent: null, evidenceCount: 0, correctCount: 0 },
          },
        },
      }),
    );
    expect(markup).not.toContain('>重测<');
    expect(markup).toContain('阶段掌握度 40%（基于 2 次）');
    expect(markup).toContain('尚未重测');
    expect(markup).not.toContain('补强后 0%');
    expect(markup).not.toContain('补强后 100%');
  });

  it('补强后有证据时写新增条数与正确数，不写补强后百分数', () => {
    const phaseId = 'phase-a';
    const markup = renderToStaticMarkup(
      createElement(PhaseRings, {
        items: [
          {
            subject: '阶段一',
            phaseId,
            percent: 63,
            evidenceCount: 15,
            completionRate: 100,
            taskDone: 2,
            taskTotal: 2,
          },
        ],
        reinforceOutcomesByPhase: {
          [phaseId]: {
            phaseId,
            overall: { percent: 63, evidenceCount: 15 },
            before: { percent: 54, evidenceCount: 12 },
            after: { percent: 100, evidenceCount: 3, correctCount: 3 },
          },
        },
      }),
    );
    expect(markup).toContain('阶段掌握度 63%（基于 15 次）');
    expect(markup).toContain('补强后新增 3 次作答，其中 3 次正确');
    expect(markup).not.toContain('补强后 100%');
  });

  it('没有补强任务的阶段不显示补强前后文案', () => {
    const markup = renderToStaticMarkup(
      createElement(PhaseRings, {
        items: [
          {
            subject: '阶段一',
            phaseId: 'phase-a',
            percent: 40,
            evidenceCount: 2,
            completionRate: 100,
            taskDone: 2,
            taskTotal: 2,
          },
        ],
        reinforceOutcomesByPhase: {},
      }),
    );
    expect(markup).not.toContain('尚未重测');
    expect(markup).not.toContain('阶段掌握度');
    expect(markup).not.toContain('补强前');
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
