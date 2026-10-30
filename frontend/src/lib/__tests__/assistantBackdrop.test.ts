import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { clearAssistantBackdrop } from '../assistantBackdrop';

describe('assistant video backdrop', () => {
  it('keeps actual video shoe uppers opaque and clears the floor between outstretched legs', () => {
    const frames = gunzipSync(readFileSync(new URL('./fixtures/assistant-matting.rgba.gz', import.meta.url)));
    const frameBytes = 256 * 256 * 4;
    const alpha = (data: Uint8ClampedArray, x: number, y: number) => data[(y * 256 + x) * 4 + 3];
    const idle = new Uint8ClampedArray(frames.subarray(0, frameBytes));
    clearAssistantBackdrop({ width: 256, height: 256, data: idle });
    expect(alpha(idle, 114, 230)).toBe(255);
    const seated = new Uint8ClampedArray(frames.subarray(frameBytes * 4, frameBytes * 5));
    clearAssistantBackdrop({ width: 256, height: 256, data: seated });
    expect(alpha(seated, 110, 206)).toBe(255);
    expect(alpha(seated, 130, 225)).toBe(0);
    expect(alpha(seated, 140, 230)).toBe(0);
  });
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
