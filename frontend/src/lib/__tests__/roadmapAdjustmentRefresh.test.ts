import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Roadmap adjustment refresh wiring', () => {
  it('reloads on planDataEpoch and binds activePlanId from latest plan', () => {
    const source = readFileSync(
      new URL('../../pages/RoadmapPage.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('planDataEpoch');
    expect(source).toContain('setActivePlanId');
    expect(source).toContain('latest.plan?.id');
  });

  it('assistant regenerate uses resolvePlanTargetId not lastPlanId alone', () => {
    const source = readFileSync(
      new URL('../../hooks/useAssistantChat.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('resolvePlanTargetId');
    expect(source).toContain('targetPlanId');
    expect(source).toContain('streamPlanRegenerate(\n              targetPlanId');
  });
});
