/**
 * 统一 API 客户端：Base URL、Cookie 鉴权、错误解析、AbortSignal。
 * 页面组件不得直接 fetch；业务模块经此层或各 *Api 封装调用。
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface ErrorPayload {
  status?: string;
  error?: string;
  code?: string;
  message?: string;
  detail?: string | { code?: string; message?: string };
  retryAfterSeconds?: number;
}

function apiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return raw?.replace(/\/$/, '') ?? '';
}

export function getApiBaseUrl(): string {
  return apiBaseUrl();
}

function parseError(payload: ErrorPayload | null): {
  code: string;
  message: string;
  retryAfterSeconds?: number;
} {
  const detail = payload?.detail;
  const detailCode = typeof detail === 'object' ? detail.code : undefined;
  const detailMessage = typeof detail === 'string' ? detail : detail?.message;
  return {
    code: payload?.code ?? payload?.error ?? detailCode ?? 'REQUEST_FAILED',
    message: payload?.message ?? detailMessage ?? '请求失败，请稍后重试',
    retryAfterSeconds: payload?.retryAfterSeconds,
  };
}

/** JSON 或 FormData 请求；始终携带会话 Cookie。 */
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const body = init?.body;
  if (typeof body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      credentials: 'include',
      headers,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接服务器，请检查网络后重试');
  }

  const payload = (await response.json().catch(() => null)) as (T & ErrorPayload) | null;

  if (!response.ok || (payload && 'status' in payload && payload.status === 'error')) {
    const err = parseError(payload as ErrorPayload | null);
    throw new ApiError(response.status, err.code, err.message, err.retryAfterSeconds);
  }

  if (payload === null) {
    throw new ApiError(0, 'INVALID_RESPONSE', '服务器响应异常，请稍后重试');
  }

  return payload as T;
}
