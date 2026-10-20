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

  it('lays a wide band across the vine, stopping above today', () => {
    expect(VINE_RIGHT.length).toBe(VINE_LEFT.length);
    const viewW = 1440;
    const viewH = 900;
    const at = (delta: number) => {
      const slot = PLATE_SLOTS.find((item) => item.delta === delta)!;
      return coverPoint(slot.fx, slot.fy, viewW, viewH);
    };
    const nodes = [1, 2, 3, 4].map(at);
    const today = at(0);
    const frame = cloudFrameForSegment(nodes, viewW, viewH, today.y);
    expect(frame).not.toBeNull();
    if (!frame) return;
    const scale = Math.max(viewW / 1280, viewH / 720);
    const offsetY = (720 * scale - viewH) / 2;
    const offsetX = (1280 * scale - viewW) / 2;
    const plateYs = nodes.map((node) => (node.y + offsetY) / scale);
    const vineL = vineLeftPlate(Math.min(...plateYs) - 28, Math.max(...plateYs) + 28) * scale - offsetX;
    const vineR = vineRightPlate(Math.min(...plateYs) - 28, Math.max(...plateYs) + 28) * scale - offsetX;
    expect(frame.left).toBeLessThanOrEqual(vineL - 140);
    expect(frame.left + frame.width).toBeGreaterThanOrEqual(Math.min(viewW - 8, vineR + 140));
    expect(frame.left).toBeGreaterThanOrEqual(8);
    expect(frame.left + frame.width).toBeLessThanOrEqual(viewW - 8);
    expect(frame.top + frame.height).toBeLessThan(today.y - 30);
    expect(frame.top).toBeLessThan(Math.max(...nodes.map((node) => node.y)));
    expect(frame.height).toBeGreaterThanOrEqual(220);
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
