import { describe, expect, it } from 'vitest';

import { climbSpan, layoutDays, primaryTag, scrollTopForToday, todayCta, vinePath, visibleIndices } from './layout';
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
