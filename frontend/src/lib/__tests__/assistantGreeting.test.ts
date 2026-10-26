import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSISTANT_GREETING, startAssistantGreeting } from '../assistantGreeting';

class Utterance {
  constructor(public text: string) {}
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
}

const voice = (name: string, lang = 'zh-CN') => ({ name, lang }) as SpeechSynthesisVoice;

describe('assistant entrance greeting', () => {
  let surface: EventTarget;
  let synth: EventTarget & {
    getVoices: ReturnType<typeof vi.fn>;
    speak: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    surface = new EventTarget();
    synth = Object.assign(new EventTarget(), {
      getVoices: vi.fn(() => [voice('Microsoft Huihui')]),
      speak: vi.fn(),
      cancel: vi.fn(),
    });
    vi.stubGlobal('window', Object.assign(surface, {
      speechSynthesis: synth,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    }));
    vi.stubGlobal('document', { hidden: false });
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('waits for entrance and prefers a natural Chinese female voice', () => {
    const natural = voice('Microsoft Xiaoxiao Online (Natural)');
    synth.getVoices.mockReturnValue([
      voice('Microsoft Yunxi Online (Natural)'), voice('Microsoft Huihui'), natural,
    ]);
    cleanup = startAssistantGreeting();
    vi.advanceTimersByTime(249);
    expect(synth.speak).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(synth.speak).toHaveBeenCalledWith(expect.objectContaining({
      text: ASSISTANT_GREETING, voice: natural, lang: 'zh-CN',
    }));
    synth.dispatchEvent(new Event('voiceschanged'));
    vi.runAllTimers();
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it('waits for asynchronously loaded voices without speaking twice', () => {
    synth.getVoices.mockReturnValue([]);
    cleanup = startAssistantGreeting();
    vi.advanceTimersByTime(250);
    expect(synth.speak).not.toHaveBeenCalled();
    synth.getVoices.mockReturnValue([voice('Microsoft Xiaoxiao Online (Natural)')]);
    synth.dispatchEvent(new Event('voiceschanged'));
    vi.runAllTimers();
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it('uses the browser default if the voice list stays empty', () => {
    synth.getVoices.mockReturnValue([]);
    cleanup = startAssistantGreeting();
    vi.advanceTimersByTime(900);
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it('retries a blocked greeting on a user gesture and removes retry listeners', () => {
    cleanup = startAssistantGreeting();
    vi.advanceTimersByTime(250);
    const greeting = synth.speak.mock.calls[0][0] as Utterance;
    greeting.onerror?.({ error: 'not-allowed' });
    surface.dispatchEvent(new Event('pointerdown'));
    surface.dispatchEvent(new Event('keydown'));
    expect(synth.speak).toHaveBeenCalledTimes(2);
    cleanup();
    surface.dispatchEvent(new Event('pointerdown'));
    expect(synth.speak).toHaveBeenCalledTimes(2);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels pending speech on exit and welcomes again on the next entrance', () => {
    cleanup = startAssistantGreeting();
    cleanup();
    vi.runAllTimers();
    expect(synth.speak).not.toHaveBeenCalled();
    cleanup = startAssistantGreeting();
    vi.advanceTimersByTime(250);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    cleanup();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    cleanup = undefined;
  });
});
