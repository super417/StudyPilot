import { afterEach, describe, expect, it, vi } from 'vitest';
import { companionAnchorFromPosition, companionPositionFromAnchor, createCompanionClickIntent, defaultCompanionAnchor, readCompanionAnchor } from '../companionVisibility';

describe('人物与头像共享的底部中心锚点', () => {
  it('在视口内拖动头像后展开全身再收起，锚点保持一致', () => {
    const viewport = { width: 1280, height: 900 };
    const original = { x: 420, y: 520 };
    const anchor = companionAnchorFromPosition(original, 76, viewport);
    const expanded = companionPositionFromAnchor(anchor, 235, viewport);
    expect(expanded.x + 235 / 2).toBeCloseTo(original.x + 38);
    expect(expanded.y + 235).toBeCloseTo(original.y + 76);
    const movedAnchor = companionAnchorFromPosition(expanded, 235, viewport);
    expect(companionPositionFromAnchor(movedAnchor, 76, viewport, 18)).toEqual(original);
  });
  it('边角展开钳制在视口内，临时钳制不改写原锚点', () => {
    const viewport = { width: 390, height: 844 };
    const anchor = defaultCompanionAnchor(viewport);
    const saved = JSON.stringify(anchor);
    const full = companionPositionFromAnchor(anchor, 235, viewport);
    expect(full.x).toBeGreaterThanOrEqual(0);
    expect(full.x + 235).toBeLessThanOrEqual(viewport.width);
    expect(full.y + 235).toBeLessThanOrEqual(viewport.height);
    expect(JSON.stringify(anchor)).toBe(saved);
    const compact = companionPositionFromAnchor(anchor, 76, viewport, 18);
    expect(compact.x).toBe(306);
    expect(compact.y + 94).toBe(832);
  });
  it('缩放后保留相对锚点并拒绝损坏或非有限存储', () => {
    const anchor = readCompanionAnchor('{"x":0.5,"y":0.8}')!;
    expect(companionPositionFromAnchor(anchor, 76, { width: 1000, height: 800 })).toEqual({ x: 462, y: 564 });
    expect(companionPositionFromAnchor(anchor, 76, { width: 500, height: 400 })).toEqual({ x: 212, y: 244 });
    for (const value of ['broken', '{"x":null,"y":0.2}', '{"x":1e309,"y":0.2}', '{"x":-0.1,"y":0.2}', '{"x":0.1,"y":2}', '{"x":"0.1","y":0.2}']) expect(readCompanionAnchor(value)).toBeNull();
  });
});

describe('单击、双击、键盘与拖动意图', () => {
  afterEach(() => vi.useRealTimers());
  it('单击等待450ms窗口结束才聊天，双击只展开不先聊天', () => {
    vi.useFakeTimers();
    const chat = vi.fn(), expand = vi.fn();
    const intent = createCompanionClickIntent(chat, expand);
    intent.click(1);
    vi.advanceTimersByTime(200);
    expect(chat).not.toHaveBeenCalled();
    intent.click(2);
    intent.doubleClick();
    vi.advanceTimersByTime(1000);
    expect(expand).toHaveBeenCalledTimes(1);
    expect(chat).not.toHaveBeenCalled();
    intent.click(1);
    vi.advanceTimersByTime(450);
    expect(chat).toHaveBeenCalledTimes(1);
  });
  it('键盘立即聊天；拖动取消待定单击且不触发双击', () => {
    vi.useFakeTimers();
    const chat = vi.fn(), expand = vi.fn();
    const intent = createCompanionClickIntent(chat, expand);
    intent.click(0);
    expect(chat).toHaveBeenCalledTimes(1);
    intent.click(1);
    intent.click(1, true);
    intent.doubleClick(true);
    vi.advanceTimersByTime(1000);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(expand).not.toHaveBeenCalled();
  });
  it('卸载或弹窗时取消排队的单击', () => {
    vi.useFakeTimers();
    const chat = vi.fn();
    const intent = createCompanionClickIntent(chat, vi.fn());
    intent.click(1);
    intent.cancel();
    vi.advanceTimersByTime(1000);
    expect(chat).not.toHaveBeenCalled();
  });
});
