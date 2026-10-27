import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../httpClient';
import { ASSISTANT_GREETING, startAssistantGreeting } from '../assistantGreeting';
import { playAssistantSpeech, speechChunks } from '../assistantSpeech';

vi.mock('../httpClient', () => ({ apiRequest: vi.fn() }));

class TestAudio {
  static instances: TestAudio[] = [];
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  constructor() { TestAudio.instances.push(this); }
}

const audioResponse = { voice: 'Xiaoxiao', mimeType: 'audio/mpeg', audioBase64: 'SUQz' };

describe('shared natural voice playback', () => {
  let surface: EventTarget;
  let cleanups: Array<() => void>;
  beforeEach(() => {
    vi.useFakeTimers();
    cleanups = [];
    TestAudio.instances = [];
    surface = new EventTarget();
    vi.stubGlobal('Audio', TestAudio);
    vi.stubGlobal('window', Object.assign(surface, {
      setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    }));
    vi.stubGlobal('document', { hidden: false });
    vi.mocked(apiRequest).mockReset().mockResolvedValue(audioResponse);
  });
  afterEach(() => {
    cleanups.forEach((stop) => stop());
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('plays the cached natural greeting after the character appears', async () => {
    cleanups.push(startAssistantGreeting());
    await vi.advanceTimersByTimeAsync(249);
    expect(apiRequest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(apiRequest).toHaveBeenCalledWith('/api/speech/greeting', expect.anything());
    expect(TestAudio.instances[0].src).toBe('data:audio/mpeg;base64,SUQz');
    expect(TestAudio.instances[0].play).toHaveBeenCalledOnce();
    expect(ASSISTANT_GREETING).toBe('hi，有什么想和我聊聊的吗？');
  });

  it('retries blocked greeting audio once on a gesture', async () => {
    cleanups.push(startAssistantGreeting());
    vi.advanceTimersByTime(250);
    const audio = TestAudio.instances[0];
    audio.play.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
    await vi.advanceTimersByTimeAsync(0);
    surface.dispatchEvent(new Event('pointerdown'));
    surface.dispatchEvent(new Event('keydown'));
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(apiRequest).toHaveBeenCalledOnce();
  });

  it('cancels delayed greeting on exit and welcomes on the next entry', async () => {
    const stop = startAssistantGreeting();
    stop();
    await vi.advanceTimersByTimeAsync(900);
    expect(apiRequest).not.toHaveBeenCalled();
    cleanups.push(startAssistantGreeting());
    await vi.advanceTimersByTimeAsync(250);
    expect(apiRequest).toHaveBeenCalledOnce();
  });

  it('reads long replies in order without losing characters', async () => {
    const text = '学'.repeat(340);
    const onEnd = vi.fn();
    cleanups.push(playAssistantSpeech(text, { onEnd }).stop);
    await vi.advanceTimersByTimeAsync(0);
    const audio = TestAudio.instances[0];
    for (let i = 0; i < 3; i++) {
      audio.onended?.();
      await vi.advanceTimersByTimeAsync(0);
    }
    const spokenText = vi.mocked(apiRequest).mock.calls.map(([, init]) => JSON.parse(init!.body as string).text).join('');
    expect(spokenText).toBe(text);
    expect(apiRequest).toHaveBeenCalledTimes(3);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('stops previous speech when a different reply starts', async () => {
    const onEnd = vi.fn();
    cleanups.push(playAssistantSpeech('第一条', { onEnd }).stop);
    await vi.advanceTimersByTimeAsync(0);
    const oldAudio = TestAudio.instances[0];
    cleanups.push(playAssistantSpeech('第二条').stop);
    expect(oldAudio.pause).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('does not play a response arriving after stop', async () => {
    let resolve!: (value: typeof audioResponse) => void;
    vi.mocked(apiRequest).mockReturnValue(new Promise((done) => { resolve = done; }));
    const playback = playAssistantSpeech('取消朗读');
    playback.stop();
    resolve(audioResponse);
    await vi.advanceTimersByTimeAsync(0);
    expect(TestAudio.instances[0].play).not.toHaveBeenCalled();
    expect(vi.mocked(apiRequest).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('reports unavailable speech without using the rejected system voice', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('语音暂未就绪'));
    const onError = vi.fn();
    cleanups.push(playAssistantSpeech('朗读', { onError }).stop);
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: '语音暂未就绪' }));
    expect(TestAudio.instances[0].play).not.toHaveBeenCalled();
  });

  it('keeps Unicode characters intact when splitting', () => {
    const text = '你好😀。'.repeat(100);
    const chunks = speechChunks(text);
    expect(chunks.join('')).toBe(text);
    expect(chunks.every((chunk) => Array.from(chunk).length <= 160)).toBe(true);
  });
});
