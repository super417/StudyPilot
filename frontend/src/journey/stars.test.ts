import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { STAR_THRESHOLDS, completionPercent, computeStars, starColor, tasksUntilFourStars } from './stars';

describe('journey stars', () => {
  it('locks the same boundaries the backend exports', () => {
    expect(STAR_THRESHOLDS).toEqual([40, 60, 80]);
  });

  it('puts the boundaries on the higher tier, including a zero-done day', () => {
    expect(computeStars(0, 0)).toBeNull();
    expect(computeStars(4, 0)).toBe(1);
    expect(computeStars(100, 39)).toBe(1);
    expect(computeStars(100, 40)).toBe(2);
    expect(computeStars(100, 59)).toBe(2);
    expect(computeStars(100, 60)).toBe(3);
    expect(computeStars(100, 79)).toBe(3);
    expect(computeStars(100, 80)).toBe(4);
    expect(computeStars(100, 100)).toBe(4);
    expect(completionPercent(200, 79)).toBe(39);
    expect(computeStars(200, 79)).toBe(1);
  });

  it('keeps unanswered gray and a partial answer off gray', () => {
    expect(starColor(0, 0)).toBe('gray');
    expect(starColor(50, 1)).toBe('cool');
    expect(starColor(80, 1)).toBe('vivid');
  });

  it('counts how many tasks light the fourth star', () => {
    expect(tasksUntilFourStars(5, 3)).toBe(1);
    expect(tasksUntilFourStars(5, 4)).toBe(0);
  });

  it('never lowers the star count when more tasks are done', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (total) => {
        let previous = computeStars(total, 0) ?? 0;
        for (let done = 1; done <= total; done += 1) {
          const current = computeStars(total, done) ?? 0;
          expect(current).toBeGreaterThanOrEqual(previous);
          previous = current;
        }
      }),
      { numRuns: 100 },
    );
  });
});
