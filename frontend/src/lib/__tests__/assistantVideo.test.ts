import { describe, expect, it } from 'vitest';
import { clearAssistantGreenScreen, nextCharacterSegment, type VideoPose } from '../assistantVideo';
import { resolveCharacterMode, type CharacterMode } from '../assistantCharacter';

describe('Ningning green-screen video', () => {
  it('removes saturated/dark green but preserves white shoes, pink laces, skin and hair', () => {
    const colors = [[0, 255, 0], [12, 150, 10], [252, 251, 248], [242, 180, 212], [230, 190, 165], [62, 31, 20]];
    const data = new Uint8ClampedArray(colors.flatMap(rgb => [...rgb, 255]));
    clearAssistantGreenScreen({ data });
    expect(colors.map((_, i) => data[i * 4 + 3])).toEqual([0, 0, 255, 255, 255, 255]);
    expect([...data.slice(8)]).toEqual(colors.slice(2).flatMap(rgb => [...rgb, 255]));
  });

  it('softens and despills compressed green edges without making them opaque again', () => {
    const data = new Uint8ClampedArray([90, 140, 85, 128]);
    clearAssistantGreenScreen({ data });
    expect(data[3]).toBeGreaterThan(0);
    expect(data[3]).toBeLessThan(128);
    expect(data[1]).toBeLessThan(140);
  });

  it('waits in separate chin and head-scratching holds, never reaching the jump by time alone', () => {
    expect(nextCharacterSegment('idle', 'open').pose).toBe('open');
    const chin = nextCharacterSegment('open', 'open');
    expect(chin.hold).toBe('open');
    expect(chin.end).toBeLessThan(4.55);
    expect(nextCharacterSegment('open', 'thinking').pose).toBe('thinking');
    const thinking = nextCharacterSegment('thinking', 'thinking');
    expect(thinking.hold).toBe('thinking');
    expect(thinking.end).toBeLessThan(9.25);
    expect(thinking.finish).toBeUndefined();
  });

  it('routes hover through standing before sitting in the chin pose', () => {
    const exit = nextCharacterSegment('hover', 'open');
    expect(exit.video).toBe('hover');
    expect(exit.pose).toBe('idle');
    expect(nextCharacterSegment(exit.pose, 'open').pose).toBe('open');
  });

  it.each<VideoPose>(['open', 'thinking'])('cancels %s through its exit clip without celebrating', pose => {
    const exit = nextCharacterSegment(pose, 'idle');
    expect(exit.video).toBe(pose === 'open' ? 'chinExit' : 'thinkingExit');
    expect(exit.pose).toBe('idle');
    expect(exit.finish).toBeUndefined();
  });

  it.each<VideoPose>(['idle', 'open', 'hover', 'thinking'])('eventually lands after a fast answer from %s', from => {
    let pose = from;
    let complete = false;
    for (let step = 0; step < 4; step++) {
      const segment = nextCharacterSegment(pose, 'answer');
      expect(segment.hold).toBeUndefined();
      pose = segment.pose;
      if (segment.finish) { complete = true; break; }
    }
    expect(complete).toBe(true);
    expect(pose).toBe('idle');
  });

  it('plays entrance once, including landing', () => {
    const entrance = nextCharacterSegment('idle', 'entrance');
    expect(entrance.finish).toBe('entrance');
    expect(entrance.start).toBeLessThan(11);
    expect(entrance.end).toBeGreaterThan(13);
    expect(entrance.pose).toBe('idle');
  });

  it('keeps an opened chat in its waiting pose even while the pointer stays over the doll', () => {
    const mode: CharacterMode = resolveCharacterMode({ entering: false, open: true, streaming: false, answering: false, hovered: true, waitingForQuestion: true });
    expect(mode).toBe('open');
  });
});
