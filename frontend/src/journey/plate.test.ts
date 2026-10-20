import { describe, expect, it } from 'vitest';

import { PLATE_SLOTS, VINE_LEFT, VINE_RIGHT, cloudFrameForSegment, coverPoint, vineLeftPlate, vineRightPlate } from './plate';

describe('concept plate cover', () => {
  it('keeps the center of a 16:9 viewport on the concept center', () => {
    expect(coverPoint(0.5, 0.5, 1280, 720)).toEqual({ x: 640, y: 360 });
  });

  it('crops the sides when the viewport is taller than 16:9', () => {
    const point = coverPoint(0, 0.5, 390, 844);
    expect(point.x).toBeLessThan(0);
    expect(point.y).toBeCloseTo(422, 0);
  });

  it('covers the locked vine from its left edge to just past its right edge', () => {
    expect(VINE_RIGHT.length).toBe(VINE_LEFT.length);
    const viewW = 1440;
    const viewH = 900;
    const nodes = [coverPoint(0.51, 0.242, viewW, viewH), coverPoint(0.501, 0.125, viewW, viewH)];
    const today = coverPoint(0.451, 0.381, viewW, viewH);
    const frame = cloudFrameForSegment(nodes, viewW, viewH, today.y);
    expect(frame).not.toBeNull();
    if (!frame) return;
    const scale = Math.max(viewW / 1280, viewH / 720);
    const offsetY = (720 * scale - viewH) / 2;
    const offsetX = (1280 * scale - viewW) / 2;
    const plateYs = nodes.map((node) => (node.y + offsetY) / scale);
    const bandTop = Math.min(...plateYs) - 28;
    const bandBottom = Math.max(...plateYs) + 28;
    const left = Math.max(8, Math.round((vineLeftPlate(bandTop, bandBottom) - 42) * scale - offsetX));
    const right = Math.min(viewW - 8, Math.round((vineRightPlate(bandTop, bandBottom) + 42) * scale - offsetX));
    expect(frame.left).toBe(left);
    expect(frame.left + frame.width).toBe(Math.max(180, right - left) + left);
    expect(frame.left + frame.width).toBeLessThan(viewW - 40);
    expect(frame.left).toBeLessThan(Math.min(...nodes.map((node) => node.x)));
    expect(frame.left + frame.width).toBeGreaterThan(Math.max(...nodes.map((node) => node.x)));
    expect(frame.top).toBeLessThan(Math.min(...nodes.map((node) => node.y)));
    expect(frame.top + frame.height).toBeGreaterThan(Math.max(...nodes.map((node) => node.y)));
    expect(frame.top + frame.height).toBeLessThan(today.y);
    const lower = cloudFrameForSegment([coverPoint(0.62, 0.603, viewW, viewH)], viewW, viewH);
    expect(lower).not.toBeNull();
    expect(lower?.left).not.toBe(frame.left);
    expect(lower?.top).not.toBe(frame.top);
    expect(lower && lower.left + lower.width).toBeLessThan(viewW - 40);
  });
});

describe('PLATE_SLOTS', () => {
  it('zigzags: each segment of 3 climbs from lower-left to upper-right, then restarts at the left', () => {
    const sorted = [...PLATE_SLOTS].sort((a, b) => a.delta - b.delta);
    const segments = new Map<number, typeof sorted>();
    for (const slot of sorted) segments.set(slot.segment, [...(segments.get(slot.segment) ?? []), slot]);
    expect(segments.size).toBeGreaterThanOrEqual(2);
    for (const group of segments.values()) {
      expect(group.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < group.length; i += 1) {
        expect(group[i].fx).toBeGreaterThan(group[i - 1].fx);
        expect(group[i].fy).toBeLessThan(group[i - 1].fy);
      }
    }
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i].fy).toBeLessThan(sorted[i - 1].fy);
      if (sorted[i].segment !== sorted[i - 1].segment) expect(sorted[i].fx).toBeLessThan(sorted[i - 1].fx);
    }
  });

  it('sits every slot on the vine body, not in the sky', () => {
    for (const slot of PLATE_SLOTS) {
      const x = slot.fx * 1280;
      const y = slot.fy * 720;
      expect(x).toBeGreaterThan(vineLeftPlate(y - 4, y + 4) + 30);
      expect(x).toBeLessThan(vineRightPlate(y - 4, y + 4) - 30);
    }
  });
});
