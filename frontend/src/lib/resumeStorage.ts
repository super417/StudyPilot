/**
 * 内嵌简历编辑器（public/resume-site）与本地的桥接：
 * - 编辑器把简历持久化在 localStorage['resume-storage']（zustand persist 结构）；
 * - 这里负责读取/合并这份快照，供页面在 iframe 挂载前与云端同步。
 * 只做纯函数，读写 localStorage 的副作用放在 resumeDocumentSync 里。
 */

export const RESUME_STORAGE_KEY = 'resume-storage';

interface ResumeRecord {
  id?: string;
  updatedAt?: string;
  createdAt?: string;
  [key: string]: unknown;
}

interface PersistedState {
  resumes?: Record<string, ResumeRecord>;
  activeResumeId?: string | null;
  [key: string]: unknown;
}

export interface ResumeStoragePayload {
  state?: PersistedState;
  version?: number;
  [key: string]: unknown;
}

function parsePayload(raw: string | null): ResumeStoragePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as ResumeStoragePayload;
  } catch {
    return null;
  }
}

function timestampOf(record: ResumeRecord | undefined): number {
  const raw = record?.updatedAt ?? record?.createdAt;
  const parsed = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 合并两份编辑器快照：按简历 id 取 `updatedAt` 较新的一份，远端独有/本地独有的都保留。
 * 返回可直接写回 localStorage 的字符串；两边都没有有效数据时返回 null。
 */
export function mergeResumePayloads(
  localRaw: string | null,
  remoteRaw: string | null,
): string | null {
  const local = parsePayload(localRaw);
  const remote = parsePayload(remoteRaw);
  if (!local && !remote) return null;

  const localResumes = local?.state?.resumes ?? {};
  const remoteResumes = remote?.state?.resumes ?? {};
  const ids = new Set([...Object.keys(localResumes), ...Object.keys(remoteResumes)]);
  const resumes: Record<string, ResumeRecord> = {};
  for (const id of ids) {
    const localRecord = localResumes[id];
    const remoteRecord = remoteResumes[id];
    if (!localRecord) {
      resumes[id] = remoteRecord;
      continue;
    }
    if (!remoteRecord) {
      resumes[id] = localRecord;
      continue;
    }
    resumes[id] = timestampOf(remoteRecord) > timestampOf(localRecord) ? remoteRecord : localRecord;
  }

  const base = local ?? remote ?? {};
  const baseState = base.state ?? {};
  const preferredActive = local?.state?.activeResumeId ?? remote?.state?.activeResumeId ?? null;
  const activeResumeId =
    preferredActive && resumes[preferredActive] ? preferredActive : (Object.keys(resumes)[0] ?? null);

  const merged: ResumeStoragePayload = {
    ...base,
    state: { ...(remote?.state ?? {}), ...baseState, resumes, activeResumeId },
    version: local?.version ?? remote?.version ?? 0,
  };
  return JSON.stringify(merged);
}

/** 从原始快照里取「简历条数」，用于空态判断与调试展示。 */
export function countResumes(raw: string | null): number {
  const payload = parsePayload(raw);
  return Object.keys(payload?.state?.resumes ?? {}).length;
}
