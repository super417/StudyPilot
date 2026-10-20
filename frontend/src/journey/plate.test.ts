import { describe, expect, it } from 'vitest';

import { GATE_VINE_PATH, cloudGateFrame, coverPoint, nodeUnderCloud } from './plate';

describe('concept plate cover', () => {
  it('keeps the center of a 16:9 viewport on the concept center', () => {
    expect(coverPoint(0.5, 0.5, 1280, 720)).toEqual({ x: 640, y: 360 });
  });

  it('crops the sides when the viewport is taller than 16:9', () => {
    const point = coverPoint(0, 0.5, 390, 844);
    expect(point.x).toBeLessThan(0);
    expect(point.y).toBeCloseTo(422, 0);
  });

  it('sizes the cloud from the gate vine segment bbox, with sky on both sides', () => {
    const viewW = 1440;
    const viewH = 900;
    const frame = cloudGateFrame(viewW, viewH);
    const scale = Math.max(viewW / 1280, viewH / 720);
    const offsetX = (1280 * scale - viewW) / 2;
    const offsetY = (720 * scale - viewH) / 2;
    const xs = GATE_VINE_PATH.map((point) => point.x * scale - offsetX);
    const ys = GATE_VINE_PATH.map((point) => point.y * scale - offsetY);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    expect(frame.left).toBeLessThan(minX);
    expect(frame.left + frame.width).toBeGreaterThan(maxX);
    expect(frame.top).toBeLessThanOrEqual(minY);
    expect(frame.top + frame.height).toBeGreaterThanOrEqual(maxY);
    expect(frame.width).toBeGreaterThan(maxX - minX);
    expect(frame.width).toBeLessThan((maxX - minX) * 2.6);
    expect(frame.width).toBeLessThan(viewW * 0.45);
    expect(frame.left).toBeGreaterThan(viewW * 0.15);
    expect(viewW - frame.left - frame.width).toBeGreaterThan(viewW * 0.15);
    expect(frame.poleX).toBeGreaterThan(frame.left + frame.width * 0.6);
    expect(frame.poleX).toBeLessThan(frame.left + frame.width);
    const today = coverPoint(0.451, 0.381, viewW, viewH);
    expect(today.y).toBeLessThan(frame.top);
    expect(nodeUnderCloud(today.x, today.y, frame)).toBe(false);
    const below = coverPoint(0.498, 0.803, viewW, viewH);
    expect(below.y).toBeGreaterThan(frame.top + frame.height);
    expect(nodeUnderCloud(frame.left + frame.width / 2, frame.top + frame.height / 2, frame)).toBe(true);
    const narrow = cloudGateFrame(1280, 720);
    expect(frame.width / narrow.width).toBeCloseTo(scale, 1);
  });
});
