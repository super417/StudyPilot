import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiConfigApiError, getApiConfig } from '@/lib/apiConfigApi';
import {
  clearResumeAiConfig,
  syncResumeAiConfigFromPersonal,
} from '@/lib/resumeAiConfigBridge';
import { fetchResumeDocument, saveResumeDocument } from '@/lib/resumeDocumentApi';
import { mergeResumePayloads, RESUME_STORAGE_KEY } from '@/lib/resumeStorage';

export type ResumeSyncStatus = 'loading' | 'ready' | 'syncing' | 'synced' | 'offline';

const SYNC_INTERVAL_MS = 4000;

function readLocal(): string | null {
  try {
    return window.localStorage.getItem(RESUME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLocal(payload: string): void {
  try {
    window.localStorage.setItem(RESUME_STORAGE_KEY, payload);
  } catch {
    // 存储被禁用（隐私模式/配额满）时退化为仅内存，不影响编辑器使用
  }
}

/** 进入简历页时把个人中心 API 状态投影到简历侧 ai-config-storage（须在 iframe 挂载前完成）。 */
async function syncPersonalAiIntoResumeStorage(): Promise<void> {
  try {
    const cfg = await getApiConfig();
    syncResumeAiConfigFromPersonal(cfg);
  } catch (error) {
    if (error instanceof ApiConfigApiError && error.code === 'NO_API_CONFIG') {
      clearResumeAiConfig();
      return;
    }
    // 网络/鉴权失败时不盲目清空，避免短暂离线把本地已同步配置冲掉。
  }
}

/**
 * 把内嵌简历编辑器（同源 iframe，数据存在 localStorage）与账号侧快照对齐。
 *
 * 时序很关键：先把云端快照合并进 localStorage，再挂载 iframe，
 * 否则编辑器会用旧数据覆盖掉刚合并的结果。
 * AI 配置同理：个人中心投影必须在 iframe 读取 ai-config-storage 之前完成。
 */
export function useResumeDocumentSync() {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<ResumeSyncStatus>('loading');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const lastPushedRef = useRef<string | null>(null);

  const push = useCallback(async () => {
    let current: string | null = null;
    try {
      current = readLocal();
    } catch {
      return;
    }
    if (!current || current === lastPushedRef.current) return;
    setStatus('syncing');
    try {
      const saved = await saveResumeDocument(current);
      lastPushedRef.current = current;
      setLastSyncedAt(saved?.updatedAt ?? new Date().toISOString());
      setStatus('synced');
    } catch {
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await syncPersonalAiIntoResumeStorage();
        if (cancelled) return;
        const remote = await fetchResumeDocument();
        if (cancelled) return;
        const local = readLocal();
        const merged = mergeResumePayloads(local, remote?.payload ?? null);
        if (merged && merged !== local) writeLocal(merged);
        lastPushedRef.current = remote?.payload ?? null;
        setLastSyncedAt(remote?.updatedAt ?? null);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('offline');
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      void push();
    }, SYNC_INTERVAL_MS);
    const flush = () => {
      void push();
    };
    window.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
      void push();
    };
  }, [ready, push]);

  return { ready, status, lastSyncedAt, syncNow: push };
}