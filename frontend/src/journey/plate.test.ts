import { describe, expect, it } from 'vitest';

import { cloudFrameForSegment, coverPoint, vineLeftPlate } from './plate';

describe('concept plate cover', () => {
  it('keeps the center of a 16:9 viewport on the concept center', () => {
    expect(coverPoint(0.5, 0.5, 1280, 720)).toEqual({ x: 640, y: 360 });
  });

  it('crops the sides when the viewport is taller than 16:9', () => {
    const point = coverPoint(0, 0.5, 390, 844);
    expect(point.x).toBeLessThan(0);
    expect(point.y).toBeCloseTo(422, 0);
  });

  it('stretches the locked cloud from that segment’s left vine to the map’s right edge', () => {
    const viewW = 1440;
    const viewH = 900;
    const nodes = [coverPoint(0.51, 0.242, viewW, viewH), coverPoint(0.501, 0.125, viewW, viewH)];
    const frame = cloudFrameForSegment(nodes, viewW, viewH);
    expect(frame).not.toBeNull();
    if (!frame) return;
    const scale = Math.max(viewW / 1280, viewH / 720);
    const offsetY = (720 * scale - viewH) / 2;
    const plateYs = nodes.map((node) => (node.y + offsetY) / scale);
    const leftPlate = vineLeftPlate(Math.min(...plateYs) - 36, Math.max(...plateYs) + 36);
    const offsetX = (1280 * scale - viewW) / 2;
    expect(frame.left).toBe(Math.max(0, Math.min(viewW - 120, Math.round(leftPlate * scale - offsetX))));
    expect(frame.left + frame.width).toBe(viewW);
    expect(frame.left).toBeGreaterThan(80);
    expect(frame.left).toBeLessThan(Math.min(...nodes.map((node) => node.x)));
    expect(frame.top).toBeLessThan(Math.min(...nodes.map((node) => node.y)));
    expect(frame.top + frame.height).toBeGreaterThan(Math.max(...nodes.map((node) => node.y)));
    const lower = cloudFrameForSegment([coverPoint(0.62, 0.603, viewW, viewH)], viewW, viewH);
    expect(lower).not.toBeNull();
    expect(lower?.left).not.toBe(frame.left);
    expect(lower?.top).not.toBe(frame.top);
    expect(lower && lower.left + lower.width).toBe(viewW);
  });
});
