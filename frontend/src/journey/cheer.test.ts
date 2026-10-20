import { describe, expect, it } from 'vitest';

import { localCheer } from './cheer';
import { buildJourneyDemo } from './mock';

describe('local cheer', () => {
  it('uses the full-clear sentence and never says 效率', () => {
    const data = buildJourneyDemo();
    const cheer = localCheer(data, 'week', undefined, []);
    expect(cheer.ruleId).toBe('R1');
    expect(cheer.text).toContain('连续 2 天');
    expect(cheer.text).not.toContain('效率');
    const next = localCheer(data, 'week', undefined, ['R1']);
    expect(next.ruleId).not.toBe('R1');
    expect(next.text).not.toContain('效率');
  });

  it('talks about a missed day with a number', () => {
    const cheer = localCheer(buildJourneyDemo(), 'day', '2026-10-15', []);
    expect(cheer.text).toContain('10-15');
    expect(cheer.text).toMatch(/\d/);
  });
});
