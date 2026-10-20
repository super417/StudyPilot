import { describe, expect, it } from 'vitest';

import { climbSpan, currentPhase, flagAnchor, isCompactViewport, layoutDays, maxDayShiftBeforeGate, phaseBoundary, phaseGateOpen, phaseSignPoint, phaseSpans, primaryTag, scrollLead, scrollTopForToday, todayCta, vinePath, visibleIndices } from './layout';
import { buildJourneyDemo } from './mock';
import { coverPoint } from './plate';
import type { JourneyDay } from './types';

function day(partial: Partial<JourneyDay> & Pick<JourneyDay, 'date'>): JourneyDay {
  return {
    total: 0,
    done: 0,
    carried: 0,
    pending: 0,
    rate: null,
    stars: null,
    accuracy: null,
    starColor: null,
    hasCheckIn: false,
    minutes: 0,
    tags: [],
    state: 'empty',
    ...partial,
  };
}

describe('journey layout', () => {
  it('stacks dates upward and does not repeat them', () => {
    const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
    const points = layoutDays(dates, 800, false);
    expect(points.map((point) => point.date)).toEqual(dates);
    expect(new Set(points.map((point) => point.date)).size).toBe(dates.length);
    expect(points[0].y).toBeGreaterThan(points[points.length - 1].y);
    expect(points[1].x).not.toBe(points[0].x);
    expect(Math.abs(points[0].x - 400)).toBeLessThan(230);
    expect(Math.sign(points[0].x - 400)).not.toBe(Math.sign(points[1].x - 400));
  });

  it('builds a cubic path from the node coordinates', () => {
    const path = vinePath([
      { x: 10, y: 30 },
      { x: 40, y: 10 },
    ]);
    expect(path.startsWith('M 10.0 30.0 C')).toBe(true);
    expect(path).toContain('40.0 10.0');
  });

  it('keeps today around 60% down the viewport', () => {
    expect(scrollTopForToday(1000, 800, 5000)).toBe(1000 - 480);
    expect(scrollTopForToday(100, 800, 5000)).toBe(0);
  });

  it('writes the today button from real counts', () => {
    expect(
      todayCta(day({ date: '2026-10-19', total: 5, done: 3, rate: 60, stars: 3, state: 'today' })).subtitle,
    ).toBe('今日 3/5 · 再做 1 项得 4★');
    expect(todayCta(day({ date: '2026-10-19', total: 4, done: 4, rate: 100, stars: 4, state: 'today' })).title).toBe(
      '今日已全清 ✓',
    );
  });

  it('shows at most one tag, boss first', () => {
    expect(primaryTag(['carried', 'boss', 'reinforce'])).toBe('boss');
    expect(primaryTag(['carried'])).toBe('carried');
  });

  it('marks the demo phase-end day as boss', () => {
    const day = buildJourneyDemo().days.find((item) => item.date === '2026-10-16');
    expect(day?.tags).toContain('boss');
    expect(buildJourneyDemo().days.find((item) => item.date === '2026-08-31')?.tags).toContain('boss');
  });

  it('keeps plate nodes clear of compact chrome at 390×844', () => {
    expect(isCompactViewport(390, 844)).toBe(true);
    expect(isCompactViewport(1440, 900)).toBe(false);
    const top = coverPoint(0.501, 0.125, 390, 844);
    const lowest = coverPoint(0.498, 0.803, 390, 844);
    const bar = 52;
    const footer = 78;
    const homeIndicator = 34;
    expect(top.y - 32).toBeGreaterThan(bar);
    expect(lowest.y + 48).toBeLessThan(844 - footer);
    expect(lowest.y + 48).toBeLessThan(844 - (footer - 8 + homeIndicator));
  });

  it('keeps the current phase gate shut until that phase has ended and cleared', () => {
    const demo = buildJourneyDemo();
    const phase = currentPhase(demo.phases, demo.today);
    expect(phase?.endDate).toBe('2026-11-18');
    expect(phaseGateOpen(phase, demo.days)).toBe(false);
    expect(
      phaseGateOpen(
        { id: 'p', name: '已结束', startDate: '2026-10-01', endDate: '2026-10-10', index: 1 },
        [day({ date: '2026-10-10', total: 4, done: 4, rate: 100, state: 'past' })],
      ),
    ).toBe(true);
    expect(
      phaseGateOpen(
        { id: 'p', name: '未清', startDate: '2026-10-01', endDate: '2026-10-10', index: 1 },
        [day({ date: '2026-10-10', total: 4, done: 2, rate: 50, state: 'past' })],
      ),
    ).toBe(false);
  });

  it('lists phases from the bottom up and anchors a sign on the upper boundary', () => {
    const demo = buildJourneyDemo();
    const spans = phaseSpans(demo.phases);
    expect(spans.map((span) => [span.name, span.firstDate, span.lastDate, span.topDate])).toEqual([
      ['阶段一 · 扎根', '2026-07-22', '2026-08-31', '2026-08-31'],
      ['阶段二 · 数据分析', '2026-09-01', '2026-10-16', '2026-10-16'],
      ['阶段三 · 图表表达', '2026-10-17', '2026-11-18', '2026-11-18'],
    ]);
    expect(phaseBoundary(spans, 0)).toEqual({ endDate: '2026-08-31', startDate: '2026-09-01' });
    const phaseTwoTop = { x: 700, y: 720 };
    const nextLevel = { x: 900, y: 540 };
    const anchor = phaseSignPoint(phaseTwoTop, nextLevel);
    expect(anchor.y).toBeGreaterThan(nextLevel.y);
    expect(anchor.y).toBeLessThan(phaseTwoTop.y);
    const phaseStart = { x: 400, y: 1100 };
    const middle = (phaseStart.y + phaseTwoTop.y) / 2;
    expect(Math.abs(anchor.y - middle)).toBeGreaterThan(40);
  });

  it('leaves enough scroll above today to reach the first day', () => {
    const todayIndex = 89;
    const step = 140;
    const baseOrigin = 3828;
    const lead = scrollLead(todayIndex, -3, step, baseOrigin);
    const origin = baseOrigin + lead;
    const dayShiftAtTop = Math.round((0 - origin) / step);
    expect(todayIndex + -3 + dayShiftAtTop).toBeLessThanOrEqual(0);
  });

  it('stops the visible window on the phase-end day', () => {
    expect(maxDayShiftBeforeGate(80, 100, 2)).toBe(18);
    expect(maxDayShiftBeforeGate(80, 81, 2)).toBe(0);
  });

  it('hangs the flag outside the node on the open side', () => {
    expect(flagAnchor(200, 1000)).toEqual({ side: 'right', offset: 'calc(100% + 10px)' });
    expect(flagAnchor(800, 1000)).toEqual({ side: 'left', offset: 'calc(100% + 10px)' });
  });

  it('climbs at most ten nodes from the root', () => {
    expect(climbSpan(0)).toBeNull();
    expect(climbSpan(10)).toEqual({ start: 0, end: 10 });
    expect(climbSpan(11)).toBeNull();
  });

  it('keeps a one-screen buffer around the viewport', () => {
    const indices = visibleIndices([0, 100, 500, 900, 1400], 400, 300);
    expect(indices).toEqual([1, 2, 3]);
  });
});
