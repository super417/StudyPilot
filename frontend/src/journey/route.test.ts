import { describe, expect, it } from 'vitest';

import { isJourneyDemo, isJourneyRoute } from './route';

describe('journey route', () => {
  it('recognizes the fullscreen hash and the demo flag', () => {
    expect(isJourneyRoute('#/journey')).toBe(true);
    expect(isJourneyRoute('#/journey?demo=1')).toBe(true);
    expect(isJourneyRoute('#/mainframe')).toBe(false);
    expect(isJourneyDemo('#/journey')).toBe(false);
    expect(isJourneyDemo('#/journey?demo=1')).toBe(true);
  });
});
