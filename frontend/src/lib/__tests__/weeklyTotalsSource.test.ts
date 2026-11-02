import { describe, expect, it } from 'vitest';
import { weeklyTotalsSourceLabel } from '@/lib/weeklyReviewsApi';

describe('weekly totals source', () => {
  it('identifies live totals and timestamps historical snapshots in Beijing time', () => {
    expect(weeklyTotalsSourceLabel({ totalsSource: 'live' })).toContain('当前记录');
    const label = weeklyTotalsSourceLabel({ totalsSource: 'snapshot', createdAt: '2025-02-16T16:00:00' });
    expect(label).toContain('历史快照');
    expect(label).toContain('2025/2/17');
    expect(weeklyTotalsSourceLabel({})).toBe('统计来源未知');
  });
});
