import { describe, expect, it } from 'vitest';
import { CHARACTER_IMAGES, resolveCharacterMode } from '../assistantCharacter';

const resting = { entering: false, open: false, streaming: false, answering: false, hovered: false, waitingForQuestion: false };

describe('Ningning interaction sequence', () => {
  it('uses chin → puzzled → jump → standing for a complete reply', () => {
    const opened = { ...resting, open: true, waitingForQuestion: true };
    const thinking = { ...opened, streaming: true, waitingForQuestion: false };
    const answered = { ...thinking, streaming: false, answering: true };
    const settled = { ...answered, answering: false };
    const sequence = [opened, thinking, answered, settled].map((state) => CHARACTER_IMAGES[resolveCharacterMode(state)]);
    expect(sequence).toEqual([
      '/assistant/ningning/thinking.webp', '/assistant/ningning/confused.webp',
      '/assistant/ningning/jump.webp', '/assistant/ningning/idle.webp',
    ]);
  });

  it('lets hover invite, but never interrupts thinking or a completed-answer jump', () => {
    expect(resolveCharacterMode({ ...resting, hovered: true })).toBe('hover');
    expect(resolveCharacterMode(resting)).toBe('idle');
    expect(resolveCharacterMode({ ...resting, open: true, hovered: true, streaming: true })).toBe('thinking');
    expect(resolveCharacterMode({ ...resting, open: true, hovered: true, answering: true })).toBe('answer');
  });

  it('stops thinking after cancellation without celebrating, and reopens in the chin pose', () => {
    expect(resolveCharacterMode({ ...resting, open: true })).toBe('idle');
    expect(resolveCharacterMode({ ...resting, open: true, waitingForQuestion: true })).toBe('open');
    expect(resolveCharacterMode({ ...resting, answering: true })).toBe('idle');
  });
});
