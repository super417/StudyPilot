import { describe, expect, it } from 'vitest';
import { resolvePlanTargetId, resolveUndoPlanId } from '@/lib/planTarget';

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

  it('undo follows the open preview when another plan is still active', () => {
    expect(resolveUndoPlanId('preview-plan', 'other-plan', 'last-plan')).toBe('preview-plan');
    expect(resolveUndoPlanId(null, 'other-plan', 'last-plan')).toBe('other-plan');
  });
});
