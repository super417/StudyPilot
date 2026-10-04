/**
 * SSE 解析封装：fetch + ReadableStream，供规划/助手流式接口使用。
 * 禁止在页面组件散落逐行解析逻辑。
 */

import { getApiBaseUrl, ApiError } from './httpClient';

export type SseData = Record<string, unknown>;

export interface ConsumeSseOptions {
  path: string;
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  onEvent: (event: string, data: SseData) => void;
}

/**
 * A stream that opens and then says nothing is indistinguishable from a slow
 * answer, so without a budget of our own the UI spins forever. The backend
 * gives up on its first chunk at 30s; 45s leaves it room to report that itself
 * before this outer net fires.
 */
const FIRST_EVENT_TIMEOUT_MS = 45_000;

/**
 * The backend has no per-chunk budget, so a stream that dies mid-answer would
 * otherwise stay open indefinitely. Silence longer than this means it is gone.
 */
const IDLE_TIMEOUT_MS = 60_000;

const STREAM_TIMEOUT_CODE = 'STREAM_TIMEOUT';
const STREAM_TIMEOUT_MESSAGE = '服务器长时间没有响应，请重试';
const STREAM_INTERRUPTED_CODE = 'STREAM_INTERRUPTED';
const STREAM_INTERRUPTED_MESSAGE = '连接中断，请重试';

function parseFrame(raw: string): { event: string; data: SseData } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  try {
    const data = JSON.parse(dataLines.join('\n')) as SseData;
    return { event, data };
  } catch {
    return { event, data: { raw: dataLines.join('\n') } };
  }
}

/** 订阅 text/event-stream；断连时保留已回调内容由调用方负责。 */
export async function consumeSse(options: ConsumeSseOptions): Promise<void> {
  const { path, method = 'POST', body, signal, onEvent } = options;

  // The caller's signal is not the only way this ends. A stream that opens and
  // then never speaks must still be given up on, or the caller waits forever.
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) return; // already stopped: nothing left to do
  signal?.addEventListener('abort', abortFromCaller);

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
  };

  /** The original error is rethrown for a caller-initiated stop, so callers
   *  that distinguish "user pressed stop" from a real failure keep working. */
  const throwReadFailure = (cause: unknown): never => {
    if (timedOut) throw new ApiError(0, STREAM_TIMEOUT_CODE, STREAM_TIMEOUT_MESSAGE);
    if (signal?.aborted) throw cause;
    throw new ApiError(0, STREAM_INTERRUPTED_CODE, STREAM_INTERRUPTED_MESSAGE);
  };

  try {
    let response: Response;
    arm(FIRST_EVENT_TIMEOUT_MS);
    try {
      response = await fetch(`${getApiBaseUrl()}${path}`, {
        method,
        credentials: 'include',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch {
      if (signal?.aborted) return;
      if (timedOut) {
        throw new ApiError(0, STREAM_TIMEOUT_CODE, STREAM_TIMEOUT_MESSAGE);
      }
      throw new ApiError(0, 'NETWORK_ERROR', '无法连接服务器，请检查网络后重试');
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        code?: string;
        message?: string;
        status?: string;
      } | null;
      throw new ApiError(
        response.status,
        payload?.code ?? 'REQUEST_FAILED',
        payload?.message ?? '请求失败，请稍后重试',
      );
    }

    if (!response.body) {
      throw new ApiError(0, 'INVALID_RESPONSE', '服务器未返回流式内容');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        // A read that fails means the stream died: either our own budget ran
        // out, or the connection was cut mid-answer. Neither may look like a
        // slow model.
        const { done, value } = await reader
          .read()
          .catch((err: unknown) => throwReadFailure(err));
        if (done) break;
        // Bytes arrived, so the stream is alive: restart the idle budget.
        arm(IDLE_TIMEOUT_MS);
        buffer += decoder.decode(value, { stream: true });
        let sep = buffer.indexOf('\n\n');
        while (sep >= 0) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const parsed = parseFrame(frame.replace(/\r/g, ''));
          if (parsed) onEvent(parsed.event, parsed.data);
          sep = buffer.indexOf('\n\n');
        }
      }
      if (buffer.trim()) {
        const parsed = parseFrame(buffer.replace(/\r/g, ''));
        if (parsed) onEvent(parsed.event, parsed.data);
      }
    } finally {
      reader.releaseLock();
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
