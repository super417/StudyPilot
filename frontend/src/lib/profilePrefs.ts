/**
 * 用户基本信息（昵称 / 学习方向 / 目标院校专业 / 简介）。
 *
 * 后端暂无用户资料接口，这里用 localStorage 持久化，供「基本信息」卡片本地可编辑保存。
 *
 * TODO(backend): 待后端实现用户资料接口（如 GET/PUT /api/profile），
 * 将本模块改为读写后端；对外 get/save 函数签名保持不变，卡片无需改动。
 * 注意：此处只存非敏感的展示资料，绝不存储任何凭据。
 */

export interface BasicProfile {
  /** 昵称 */
  nickname: string;
  /** 学习方向 / 目标专业 */
  direction: string;
  /** 目标院校 */
  targetSchool: string;
  /** 简介 */
  bio: string;
}

const STORAGE_KEY = 'studypilot.basicProfile.v1';

const DEFAULT_PROFILE: BasicProfile = {
  nickname: '',
  direction: '',
  targetSchool: '',
  bio: '',
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 读取基本信息；缺失或损坏时返回空默认值（类型安全，不抛异常）。 */
export function getBasicProfile(): BasicProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PROFILE };
    const parsed = JSON.parse(raw) as Partial<BasicProfile>;
    return {
      nickname: asString(parsed.nickname),
      direction: asString(parsed.direction),
      targetSchool: asString(parsed.targetSchool),
      bio: asString(parsed.bio),
    };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

/** 保存基本信息并返回已保存的值。 */
export function saveBasicProfile(profile: BasicProfile): BasicProfile {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // localStorage 不可用时静默降级，本次会话内仍生效。
  }
  return profile;
}
