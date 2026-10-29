import { describe, expect, it } from 'vitest';
import { clearAssistantBackdrop } from '../assistantBackdrop';

describe('assistant video backdrop', () => {
  it('protects a white shoe with a gap in its pink edge, while clearing beige floor beside it', () => {
    const width = 20, height = 20;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set([242, 223, 210, 255], i * 4);
    for (let y = 14; y <= 18; y++) for (let x = 3; x <= 8; x++) {
      data.set([250, 246, 244, 255], (y * width + x) * 4);
      if ((x === 3 || x === 8 || y === 14 || y === 18) && !(x === 3 && y === 16)) data.set([244, 190, 218, 255], (y * width + x) * 4);
    }
    clearAssistantBackdrop({ width, height, data });
    expect(data[(16 * width + 5) * 4 + 3]).toBe(255);
    expect(data[(16 * width + 13) * 4 + 3]).toBe(0);
  });
  it('preserves pale pink shoes even when they touch the backdrop', () => {
    const colors = [[255, 255, 255], [178, 184, 209], [244, 218, 235], [235, 181, 209]];
    const data = new Uint8ClampedArray(colors.flatMap((rgb) => [...rgb, 255]));
    clearAssistantBackdrop({ width: 4, height: 1, data });
    expect([data[3], data[7], data[11], data[15]]).toEqual([0, 0, 255, 255]);
  });
  it('keeps a white shoe upper enclosed by a pink outline opaque', () => {
    const data = new Uint8ClampedArray(5 * 5 * 4).fill(255);
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        if (x !== 2 || y !== 2) data.set([244, 218, 235, 255], (y * 5 + x) * 4);
      }
    }
    clearAssistantBackdrop({ width: 5, height: 5, data });
    expect(data[3]).toBe(0);
    expect(data[(2 * 5 + 2) * 4 + 3]).toBe(255);
  });
  it('removes the warm grey floor without keeping it as shoe highlights', () => {
    const data = new Uint8ClampedArray([248, 235, 230, 255, 220, 207, 215, 255]);
    clearAssistantBackdrop({ width: 2, height: 1, data });
    expect([data[3], data[7]]).toEqual([0, 0]);
  });
});
