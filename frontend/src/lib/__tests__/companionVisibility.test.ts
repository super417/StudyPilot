import { describe, expect, it } from 'vitest';
import { companionDockLift, companionExpansionProtected, companionOverlaps, companionStartsCollapsed } from '../companionVisibility';

describe('companion visibility', () => {
  it('starts compact on phones and remembers an explicit preference', () => {
    expect(companionStartsCollapsed(null, 390)).toBe(true);
    expect(companionStartsCollapsed(null, 1440)).toBe(false);
    expect(companionStartsCollapsed('true', 1440)).toBe(true);
    expect(companionStartsCollapsed('false', 390)).toBe(false);
  });
  it('treats invalid storage as no preference', () => {
    expect(companionStartsCollapsed('broken', 390)).toBe(true);
    expect(companionStartsCollapsed('broken', 1440)).toBe(false);
  });
  it('yields only where rectangles actually overlap', () => {
    const character = { left: 100, right: 335, top: 400, bottom: 635 };
    expect(companionOverlaps(character, { left: 300, right: 400, top: 500, bottom: 550 })).toBe(true);
    expect(companionOverlaps(character, { left: 335, right: 400, top: 500, bottom: 550 })).toBe(false);
    expect(companionOverlaps(character, { left: 50, right: 500, top: 100, bottom: 400 })).toBe(false);
  });
  it('keeps explicit expansion through its own unmount and render mutations', () => {
    let protectedExpansion = companionExpansionProtected(false, 'expand');
    protectedExpansion = companionExpansionProtected(protectedExpansion, 'mutation');
    expect(protectedExpansion).toBe(true);
    expect(companionExpansionProtected(protectedExpansion, 'external')).toBe(false);
    expect(companionExpansionProtected(protectedExpansion, 'collapse')).toBe(false);
  });
  it('lifts the small dock above bottom action controls and keeps it on screen', () => {
    const dock = { left: 280, right: 382, top: 738, bottom: 790 };
    expect(companionDockLift(dock, [{ left: 0, right: 390, top: 720, bottom: 800 }])).toBe(78);
    expect(companionDockLift(dock, [{ left: 0, right: 200, top: 720, bottom: 800 }])).toBe(0);
    expect(companionDockLift(dock, [{ left: 0, right: 390, top: 0, bottom: 800 }])).toBe(0);
  });
});
