import { create } from 'zustand';
import * as authApi from '@/lib/authApi';
import { AuthApiError } from '@/lib/authApi';
import type { DataLoadResult } from '@/lib/authApi';

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  userId: string | null;
  dataLoad: DataLoadResult | null;
  error: string | null;
  checkSession: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

function dataLoadError(dataLoad?: DataLoadResult): string | null {
  return dataLoad?.status === 'degraded'
    ? dataLoad.message ?? '数据加载失败，请稍后重试'
    : null;
}

function resultState(result: authApi.AuthResult) {
  return {
    status: 'authenticated' as const,
    userId: result.userId ?? null,
    dataLoad: result.dataLoad ?? null,
    error: dataLoadError(result.dataLoad),
  };
}

function errorMessage(error: unknown): string {
  if (!(error instanceof AuthApiError)) return '请求失败，请稍后重试';

  switch (error.code) {
    case 'VALIDATION':
      return '用户名或密码格式不正确';
    case 'USERNAME_TAKEN':
      return '用户名已被占用，请换一个用户名';
    case 'INVALID_CREDENTIALS':
      return '用户名或密码错误';
    case 'LOCKED':
      return error.retryAfterSeconds
        ? `账号已被锁定，请 ${Math.ceil(error.retryAfterSeconds / 60)} 分钟后重试`
        : '账号已被锁定，请稍后重试';
    case 'SESSION_EXPIRED':
      return '登录已过期，请重新登录';
    case 'UNAUTHENTICATED':
      return '请先登录';
    case 'NETWORK_ERROR':
      return '无法连接服务器，请检查网络后重试';
    case 'INVALID_RESPONSE':
      return '服务器响应异常，请稍后重试';
    default:
      return '请求失败，请稍后重试';
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'checking',
  userId: null,
  dataLoad: null,
  error: null,

  checkSession: async () => {
    set({ status: 'checking', error: null });
    try {
      const result = await authApi.me();
      set(resultState(result));
    } catch (error) {
      const isUnauthenticated = error instanceof AuthApiError && error.status === 401;
      set({
        status: 'unauthenticated',
        userId: null,
        dataLoad: null,
        error: isUnauthenticated ? null : errorMessage(error),
      });
    }
  },

  login: async (username, password) => {
    set({ error: null });
    try {
      const result = await authApi.login({ username, password });
      set(resultState(result));
    } catch (error) {
      set({
        status: 'unauthenticated',
        userId: null,
        dataLoad: null,
        error: errorMessage(error),
      });
    }
  },

  register: async (username, password) => {
    set({ error: null });
    try {
      await authApi.register({ username, password });
      const result = await authApi.login({ username, password });
      set(resultState(result));
    } catch (error) {
      set({
        status: 'unauthenticated',
        userId: null,
        dataLoad: null,
        error: errorMessage(error),
      });
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
      set({ status: 'unauthenticated', userId: null, dataLoad: null, error: null });
    } catch (error) {
      set({
        status: 'unauthenticated',
        userId: null,
        dataLoad: null,
        error: errorMessage(error),
      });
    }
  },

  clearError: () => set({ error: null }),
}));
