import { describe, expect, it } from 'vitest';

import { climbPoints, coverPoint, phaseSignSide, pointAlong, visiblePhaseSigns } from './plate';

describe('concept plate cover', () => {
  it('keeps the center of a 16:9 viewport on the concept center', () => {
    expect(coverPoint(0.5, 0.5, 1280, 720)).toEqual({ x: 640, y: 360 });
  });

  it('crops the sides when the viewport is taller than 16:9', () => {
    const point = coverPoint(0, 0.5, 390, 844);
    expect(point.x).toBeLessThan(0);
    expect(point.y).toBeCloseTo(422, 0);
  });
});

describe('phase signs on the plate', () => {
  const days = [
    { date: '2026-10-16' },
    { date: '2026-10-17' },
    { date: '2026-10-18' },
    { date: '2026-10-19' },
  ];

  it('hangs a sign on the slot that shows a phase start', () => {
    expect(
      visiblePhaseSigns([{ name: '阶段三 · 图表表达', startDate: '2026-10-17' }], days, 3, 0),
    ).toEqual([{ name: '阶段三 · 图表表达', startDate: '2026-10-17', delta: -2, fx: 0.62, fy: 0.603 }]);
  });

  it('skips a phase start that is not on a visible slot', () => {
    expect(visiblePhaseSigns([{ name: '阶段一 · 扎根', startDate: '2026-07-22' }], days, 3, 0)).toEqual([]);
  });

  it('puts the sign opposite an outward tag and flips it when the edge is tight', () => {
    expect(phaseSignSide(900, 1440, false)).toBe('right');
    expect(phaseSignSide(900, 1440, true)).toBe('left');
    expect(phaseSignSide(360, 390, false)).toBe('left');
  });
});

describe('sprout climb along plate slots', () => {
  it('walks upward from the lowest fruit to today', () => {
    const points = climbPoints(1280, 720);
    expect(points).toHaveLength(4);
    expect(points[0].y).toBeGreaterThan(points[points.length - 1].y);
    expect(points[0]).toEqual(coverPoint(0.498, 0.803, 1280, 720));
    expect(points[points.length - 1]).toEqual(coverPoint(0.451, 0.381, 1280, 720));
  });

  it('interpolates along the polyline', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(pointAlong(points, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAlong(points, 0.25)).toEqual({ x: 5, y: 0 });
    expect(pointAlong(points, 0.5)).toEqual({ x: 10, y: 0 });
    expect(pointAlong(points, 1)).toEqual({ x: 10, y: 10 });
  });
});
