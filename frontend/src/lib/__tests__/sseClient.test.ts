import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consumeSse } from '@/lib/sseClient';

/**
 * A stream that opens, sends ``frames``, then goes silent without closing —
 * the shape of a response whose server-side generator died mid-answer. The
 * browser cannot tell that apart from a slow model, so it never settles.
 *
 * ``signal`` is wired through by hand: a real ``fetch`` ties the request's
 * abort signal to the body stream, and a stub has to do the same or the abort
 * tests would pass for the wrong reason.
 */
function silentStream(frames: string[], signal?: AbortSignal | null): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      signal?.addEventListener('abort', () => {
        controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function stubHangingFetch(frames: string[] = []): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => silentStream(frames, init?.signal)),
  );
}

describe('consumeSse 超时兜底', () => {
  beforeEach(() => {
    // Only the budget itself is faked. Faking microtasks/setImmediate stalls
    // the ReadableStream's own scheduling and nothing ever progresses.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('流开了却一个字都不发时，超时而不是永远等下去', async () => {
    stubHangingFetch();

    const promise = consumeSse({
      path: '/api/assistant/chat',
      body: { message: '两个 408 数据结构选哪一个' },
      onEvent: () => {},
    });
    const rejected = expect(promise).rejects.toMatchObject({
      name: 'ApiError',
      code: 'STREAM_TIMEOUT',
    });

    await vi.advanceTimersByTimeAsync(46_000);
    await rejected;
  });

  it('首帧之后长时间没有新帧时，同样超时', async () => {
    stubHangingFetch(['event: token\ndata: {"delta":"选"}\n\n']);

    const tokens: string[] = [];
    const promise = consumeSse({
      path: '/api/assistant/chat',
      body: { message: '两个 408 数据结构选哪一个' },
      onEvent: (event, data) => {
        if (event === 'token') tokens.push(String(data.delta ?? ''));
      },
    });
    const rejected = expect(promise).rejects.toMatchObject({ code: 'STREAM_TIMEOUT' });

    await vi.advanceTimersByTimeAsync(61_000);
    await rejected;
    // 已经收到的内容由调用方保留，不因为超时被吞掉。
    expect(tokens.join('')).toBe('选');
  });

  it('调用方主动中止时不算超时', async () => {
    stubHangingFetch();

    const controller = new AbortController();
    const promise = consumeSse({
      path: '/api/assistant/chat',
      body: { message: '你好' },
      signal: controller.signal,
      onEvent: () => {},
    });
    controller.abort();

    const error = await promise.then(
      () => null,
      (err: unknown) => err as { code?: string },
    );
    expect(error).not.toBeNull();
    expect(error?.code).not.toBe('STREAM_TIMEOUT');
  });
});
