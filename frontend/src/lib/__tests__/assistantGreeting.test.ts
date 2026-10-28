import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../httpClient';
import { ASSISTANT_GREETING, startAssistantGreeting } from '../assistantGreeting';
import { playAssistantSpeech, prewarmAssistantSpeech, speechChunks } from '../assistantSpeech';

vi.mock('../httpClient', () => ({ apiRequest: vi.fn(), getApiBaseUrl: () => '' }));

class TestAudio {
  static instances: TestAudio[] = [];
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onplaying: (() => void) | null = null;
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
    for (let i = 0; i < speechChunks(text).length; i++) {
      audio.onended?.();
      await vi.advanceTimersByTimeAsync(0);
    }
    const spokenText = vi.mocked(apiRequest).mock.calls.map(([, init]) => JSON.parse(init!.body as string).text).join('');
    expect(spokenText).toBe(text);
    expect(apiRequest).toHaveBeenCalledTimes(2);
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
    expect(chunks.every((chunk) => Array.from(chunk).length <= 280)).toBe(true);
  });

  it('only reports playing after the browser starts audio, and prepares each following segment', async () => {
    const onPlaying = vi.fn();
    const onPreparing = vi.fn();
    const playback = playAssistantSpeech('学'.repeat(340), { onPreparing, onPlaying });
    cleanups.push(playback.stop);
    expect(onPreparing).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(onPlaying).not.toHaveBeenCalled();
    const audio = TestAudio.instances[0];
    audio.onplaying?.();
    expect(onPlaying).toHaveBeenCalledOnce();
    audio.onended?.();
    expect(onPreparing).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    playback.stop();
    expect(audio.onplaying).toBeNull();
  });

  it('starts native streaming with an authenticated opaque URL instead of buffering the audio', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ voice: 'Xiaoxiao', audioPath: '/api/speech/playback/safe-token' });
    const onPlaying = vi.fn();
    cleanups.push(playAssistantSpeech('只朗读选中的正文', { onPlaying }).stop);
    await vi.advanceTimersByTimeAsync(0);
    const audio = TestAudio.instances[0];
    expect(audio.src).toBe('/api/speech/playback/safe-token');
    expect(apiRequest).toHaveBeenCalledWith('/api/speech/playback', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ text: '只朗读选中的正文' }),
    }));
    expect(audio.play).toHaveBeenCalledOnce();
    expect(onPlaying).not.toHaveBeenCalled();
    audio.onplaying?.();
    expect(onPlaying).toHaveBeenCalledOnce();
  });

  it('rejects a playback URL outside the authenticated speech route', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ voice: 'Xiaoxiao', audioPath: 'https://untrusted.example/audio' });
    const onError = vi.fn();
    cleanups.push(playAssistantSpeech('选中的正文', { onError }).stop);
    await vi.advanceTimersByTimeAsync(0);
    expect(TestAudio.instances[0].play).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('prepares only the supplied new reply, in order, without playing any audio', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ ready: true });
    const body = '新回复正文'.repeat(80);
    await prewarmAssistantSpeech(body);
    expect(TestAudio.instances).toHaveLength(0);
    const requests = vi.mocked(apiRequest).mock.calls;
    expect(requests.every(([path]) => path === '/api/speech/prewarm')).toBe(true);
    expect(requests.map(([, init]) => JSON.parse(init!.body as string).text).join('')).toBe(body);
  });

  it('does not interrupt chat or continue uploading later chunks when prewarming fails', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('offline'));
    await expect(prewarmAssistantSpeech('新回复'.repeat(200))).resolves.toBeUndefined();
    expect(apiRequest).toHaveBeenCalledOnce();
    expect(TestAudio.instances).toHaveLength(0);
  });
});
