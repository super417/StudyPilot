import { apiRequest, ApiError } from './httpClient';

export interface DataLoadResult {
  status: 'ok' | 'degraded';
  code?: string;
  message?: string;
  data?: {
    apiConfig: {
      configured: boolean;
      isVerified: boolean;
    };
    plans: number;
    checkIns: number;
    mistakes: number;
    weeklyReviews: number;
  };
}

export interface AuthResult {
  status: 'ok' | 'degraded';
  code?: string;
  message?: string;
  userId?: string;
  dataLoad?: DataLoadResult;
}

/** 兼容既有 authStore：与 ApiError 为同一构造器。 */
export { ApiError as AuthApiError };

interface Credentials {
  username: string;
  password: string;
}

export function register(credentials: Credentials): Promise<AuthResult> {
  return apiRequest<AuthResult>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

export function login(credentials: Credentials): Promise<AuthResult> {
  return apiRequest<AuthResult>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

export function logout(): Promise<AuthResult> {
  return apiRequest<AuthResult>('/api/auth/logout', { method: 'POST' });
}

export function me(): Promise<AuthResult> {
  return apiRequest<AuthResult>('/api/auth/me');
}
