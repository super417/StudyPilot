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

  it('overview reloads on planDataEpoch and undo uses the preview plan', () => {
    const overview = readFileSync(
      new URL('../../pages/OverviewPage.tsx', import.meta.url),
      'utf8',
    );
    const bar = readFileSync(
      new URL('../../components/assistant/AdjustmentPreviewBar.tsx', import.meta.url),
      'utf8',
    );
    expect(overview).toContain('planDataEpoch');
    expect(overview).toMatch(/\[reload, lastPlanId, planDataEpoch\]/);
    expect(bar).toContain('resolveUndoPlanId(pending?.planId');
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
