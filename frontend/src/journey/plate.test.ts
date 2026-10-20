import { describe, expect, it } from 'vitest';

import { cloudGateFrame, coverPoint, nodeUnderCloud } from './plate';

describe('concept plate cover', () => {
  it('keeps the center of a 16:9 viewport on the concept center', () => {
    expect(coverPoint(0.5, 0.5, 1280, 720)).toEqual({ x: 640, y: 360 });
  });

  it('crops the sides when the viewport is taller than 16:9', () => {
    const point = coverPoint(0, 0.5, 390, 844);
    expect(point.x).toBeLessThan(0);
    expect(point.y).toBeCloseTo(422, 0);
  });

  it('plants the phase flag in the cloud over the right-hand slot', () => {
    const frame = cloudGateFrame(1440, 900);
    const slot = coverPoint(0.62, 0.603, 1440, 900);
    expect(frame.poleX).toBe(Math.round(slot.x));
    expect(Math.abs(frame.top + frame.poleY - slot.y)).toBeLessThan(1);
    expect(frame.height).toBeGreaterThanOrEqual(Math.round(900 * 0.28));
    expect(nodeUnderCloud(slot.y, frame)).toBe(true);
    expect(nodeUnderCloud(coverPoint(0.623, 0.464, 1440, 900).y, frame)).toBe(true);
    expect(nodeUnderCloud(coverPoint(0.451, 0.381, 1440, 900).y, frame)).toBe(false);
  });
});
