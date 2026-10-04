import { describe, expect, it } from 'vitest';
import { formatMessageTime } from '@/components/chat/UserMessage';

describe('formatMessageTime', () => {
  it('显示月日和时分', () => {
    expect(formatMessageTime(new Date(2026, 9, 2, 13, 34).getTime())).toBe('10月2日 13:34');
  });
});
