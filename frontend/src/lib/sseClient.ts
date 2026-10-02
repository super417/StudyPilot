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
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch {
    if (signal?.aborted) return;
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
      const { done, value } = await reader.read();
      if (done) break;
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
}
