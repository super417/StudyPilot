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

  it('keeps a local cloud on the vine with sky on both sides', () => {
    const frame = cloudGateFrame(1440, 900);
    const slot = coverPoint(0.62, 0.603, 1440, 900);
    expect(frame.width).toBeLessThanOrEqual(1440 * 0.42 + 1);
    expect(frame.height / frame.width).toBeCloseTo(0.55, 1);
    expect(frame.left).toBeGreaterThanOrEqual(1440 * 0.28 - 1);
    expect(1440 - frame.left - frame.width).toBeGreaterThanOrEqual(1440 * 0.28 - 1);
    expect(frame.poleX).toBeGreaterThan(frame.left + frame.width * 0.7);
    expect(frame.poleX).toBeLessThan(frame.left + frame.width);
    expect(nodeUnderCloud(slot.x, slot.y, frame)).toBe(true);
    const today = coverPoint(0.451, 0.381, 1440, 900);
    expect(nodeUnderCloud(today.x, today.y, frame)).toBe(false);
  });
});
