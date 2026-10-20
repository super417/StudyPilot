/**
 * 用户基本信息（昵称 / 学习方向 / 目标院校 / 简介 / 助手名字）。
 *
 * 读写走 GET/PUT /api/profile。旧版 localStorage 仅在服务端仍为空时迁移一次。
 */
import { apiRequest } from './httpClient';

export interface BasicProfile {
  nickname: string;
  direction: string;
  targetSchool: string;
  bio: string;
  assistantName: string;
}

const STORAGE_KEY = 'studypilot.basicProfile.v1';
const MIGRATED_KEY = 'studypilot.basicProfile.migrated.v1';
export const ASSISTANT_NAME_SKIPPED_KEY = 'studypilot.assistantName.skipped.v1';
export const DEFAULT_ASSISTANT_LABEL = '你的学伴';

const DEFAULT_PROFILE: BasicProfile = {
  nickname: '',
  direction: '',
  targetSchool: '',
  bio: '',
  assistantName: '',
};

/** In-flight GET dedupe so ChatWindow / ChatPanel / 起名条不各自打一遍。 */
let inflightFetch: Promise<BasicProfile> | null = null;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalize(raw: Partial<BasicProfile> | null | undefined): BasicProfile {
  return {
    nickname: asString(raw?.nickname),
    direction: asString(raw?.direction),
    targetSchool: asString(raw?.targetSchool),
    bio: asString(raw?.bio),
    assistantName: asString(raw?.assistantName),
  };
}

function readLocal(): BasicProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PROFILE };
    return normalize(JSON.parse(raw) as Partial<BasicProfile>);
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

function writeLocal(profile: BasicProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // ignore quota / private mode
  }
}

function isEmpty(profile: BasicProfile): boolean {
  return !(
    profile.nickname ||
    profile.direction ||
    profile.targetSchool ||
    profile.bio
  );
}

/** 展示用称呼：有名字用名字，否则「你的学伴」。 */
export function displayAssistantName(name: string | null | undefined): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed || DEFAULT_ASSISTANT_LABEL;
}

export function hasSkippedAssistantName(): boolean {
  try {
    return localStorage.getItem(ASSISTANT_NAME_SKIPPED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSkippedAssistantName(skipped: boolean): void {
  try {
    if (skipped) {
      localStorage.setItem(ASSISTANT_NAME_SKIPPED_KEY, '1');
    } else {
      localStorage.removeItem(ASSISTANT_NAME_SKIPPED_KEY);
    }
  } catch {
    // ignore
  }
}

/** 同步读本地缓存（首屏占位）；完整数据以 fetchBasicProfile 为准。 */
export function getBasicProfile(): BasicProfile {
  return readLocal();
}

async function fetchBasicProfileOnce(): Promise<BasicProfile> {
  const res = await apiRequest<{ status: string; profile: BasicProfile }>('/api/profile');
  let profile = normalize(res.profile);
  const migrated = (() => {
    try {
      return localStorage.getItem(MIGRATED_KEY) === '1';
    } catch {
      return true;
    }
  })();
  if (isEmpty(profile) && !migrated) {
    const local = readLocal();
    if (!isEmpty(local)) {
      // 迁移旧四字段时保留服务端 assistantName，避免空本地缓存清空已有名字。
      profile = await saveBasicProfile({
        ...local,
        assistantName: profile.assistantName,
      });
    }
    try {
      localStorage.setItem(MIGRATED_KEY, '1');
    } catch {
      // ignore
    }
  }
  writeLocal(profile);
  return profile;
}

/** GET /api/profile；服务端四字段为空时把旧 localStorage 迁上去（保留服务端助手名）。 */
export async function fetchBasicProfile(): Promise<BasicProfile> {
  if (inflightFetch) return inflightFetch;
  inflightFetch = fetchBasicProfileOnce().finally(() => {
    inflightFetch = null;
  });
  return inflightFetch;
}

/** PUT /api/profile */
export async function saveBasicProfile(profile: BasicProfile): Promise<BasicProfile> {
  const cleaned = normalize(profile);
  const res = await apiRequest<{ status: string; profile: BasicProfile }>('/api/profile', {
    method: 'PUT',
    body: JSON.stringify(cleaned),
  });
  const saved = normalize(res.profile);
  writeLocal(saved);
  try {
    localStorage.setItem(MIGRATED_KEY, '1');
  } catch {
    // ignore
  }
  return saved;
}

/**
 * 起名保存：先拉当前资料再合并写入，避免只带名字的 PUT 清空其它字段。
 * 成功后清掉「已跳过」标记。
 */
export async function saveAssistantName(name: string): Promise<BasicProfile> {
  const current = await fetchBasicProfile();
  const saved = await saveBasicProfile({ ...current, assistantName: name });
  setSkippedAssistantName(false);
  return saved;
}
