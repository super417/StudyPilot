import { describe, expect, it } from 'vitest';
import { formatBillingDateTime } from '../billingDateTime';

describe('formatBillingDateTime', () => {
  it('converts UTC to Beijing time across the month boundary at midnight', () => {
    expect(formatBillingDateTime('2026-10-31T16:00:00+00:00')).toBe('2026-11-01 00:00:00（北京时间）');
  });

  it('honors the input offset without adding eight hours twice', () => {
    expect(formatBillingDateTime('2026-11-01T00:00:00+08:00')).toBe('2026-11-01 00:00:00（北京时间）');
  });

  it('falls back for invalid and missing timestamps', () => {
    expect(formatBillingDateTime('invalid')).toBe('invalid');
    expect(formatBillingDateTime('')).toBe('暂不可用');
  });
});
