import { describe, expect, it } from 'vitest';
import { matchQuestion, matchQueueFilter, type QueueFilter } from '@/lib/mistakesApi';

const pending = { reviewStatus: 'pending' as const };
const due = { reviewStatus: 'scheduled' as const, due: true };
const later = { reviewStatus: 'scheduled' as const, due: false };
const done = { reviewStatus: 'done' as const };

describe('matchQueueFilter', () => {
  it('按到期和复习状态筛', () => {
    const cases: Array<[QueueFilter, boolean, boolean, boolean, boolean]> = [
      ['all', true, true, true, true],
      ['due', false, true, false, false],
      ['pending', true, false, false, false],
      ['scheduled', false, true, true, false],
      ['done', false, false, false, true],
    ];
    for (const [filter, a, b, c, d] of cases) {
      expect(matchQueueFilter(pending, filter)).toBe(a);
      expect(matchQueueFilter(due, filter)).toBe(b);
      expect(matchQueueFilter(later, filter)).toBe(c);
      expect(matchQueueFilter(done, filter)).toBe(d);
    }
  });

  it('按原题关键词筛，空关键词全留', () => {
    expect(matchQuestion('求极限 lim sinx/x', '')).toBe(true);
    expect(matchQuestion('求极限 lim sinx/x', '  SINX ')).toBe(true);
    expect(matchQuestion('求极限 lim sinx/x', '积分')).toBe(false);
  });
});
