import { describe, expect, it } from 'vitest';
import { resolvePlanTargetId } from '@/lib/planTarget';

describe('resolvePlanTargetId', () => {
  it('prefers activePlanId over lastPlanId', () => {
    expect(resolvePlanTargetId('viewing', 'generated')).toBe('viewing');
  });

  it('falls back to lastPlanId when active is null', () => {
    expect(resolvePlanTargetId(null, 'generated')).toBe('generated');
  });

  it('returns null when neither is set', () => {
    expect(resolvePlanTargetId(null, null)).toBeNull();
  });
});
