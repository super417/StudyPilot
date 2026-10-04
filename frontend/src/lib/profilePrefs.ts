/**
 * 用户基本信息（昵称 / 学习方向 / 目标院校 / 简介）。
 *
 * 读写走 GET/PUT /api/profile。旧版 localStorage 仅在服务端仍为空时迁移一次。
 */
import { apiRequest } from './httpClient';

export interface BasicProfile {
  nickname: string;
  direction: string;
  targetSchool: string;
  bio: string;
}

const STORAGE_KEY = 'studypilot.basicProfile.v1';
const MIGRATED_KEY = 'studypilot.basicProfile.migrated.v1';

const DEFAULT_PROFILE: BasicProfile = {
  nickname: '',
  direction: '',
  targetSchool: '',
  bio: '',
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalize(raw: Partial<BasicProfile> | null | undefined): BasicProfile {
  return {
    nickname: asString(raw?.nickname),
    direction: asString(raw?.direction),
    targetSchool: asString(raw?.targetSchool),
    bio: asString(raw?.bio),
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

/** 同步读本地缓存（首屏占位）；完整数据以 fetchBasicProfile 为准。 */
export function getBasicProfile(): BasicProfile {
  return readLocal();
}

/** GET /api/profile；服务端为空时把旧 localStorage 迁上去。 */
export async function fetchBasicProfile(): Promise<BasicProfile> {
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
      profile = await saveBasicProfile(local);
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
