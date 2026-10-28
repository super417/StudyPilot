/**
 * 简历编辑器（magic-resume / resume-site）AI 配置桥接。
 *
 * 个人中心「API 调用与模型配置」是唯一事实来源（后端加密存 Key）。
 * 简历侧 zustand persist 键 `ai-config-storage` 需要本地非空 apiKey 才会显示「已配置」。
 * 此处写入哨兵 Key，真实调用走 StudyPilot 后端 /api/grammar|/api/polish|/api/ai-test，
 * 由服务端解密个人中心凭证，明文 Key 永不进入前端响应。
 */

export const RESUME_AI_CONFIG_STORAGE_KEY = 'ai-config-storage';

/** 简历侧识别为「已配置」的哨兵；后端代理会忽略并改用个人中心凭证。 */
export const STUDYPILOT_MANAGED_API_KEY = '__STUDYPILOT_MANAGED__';

export type ResumeAiProvider =
  | 'openai'
  | 'gemini'
  | 'deepseek'
  | 'anthropic'
  | 'qwen'
  | 'doubao';

export interface PersonalApiConfigSnapshot {
  modelType: string;
  baseUrl: string;
  isVerified: boolean;
}

interface BuiltinMeta {
  id: string;
  name: string;
  supportsPdf: boolean;
}

const DEEPSEEK_BUILTINS: Record<string, BuiltinMeta> = {
  'deepseek-flash': {
    id: 'deepseek-flash',
    name: 'DeepSeek V4.1 Flash',
    supportsPdf: true,
  },
  'deepseek-v4-pro': {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    supportsPdf: false,
  },
  'deepseek-chat': {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    supportsPdf: false,
  },
  'deepseek-reasoner': {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    supportsPdf: false,
  },
};

function inferProvider(baseUrl: string, modelType: string): ResumeAiProvider {
  const host = baseUrl.trim().toLowerCase();
  const model = modelType.trim().toLowerCase();
  if (host.includes('deepseek') || model.startsWith('deepseek')) return 'deepseek';
  if (host.includes('generativelanguage') || host.includes('googleapis') || model.startsWith('gemini')) {
    return 'gemini';
  }
  if (host.includes('anthropic') || model.startsWith('claude')) return 'anthropic';
  if (host.includes('dashscope') || host.includes('aliyun') || model.startsWith('qwen')) return 'qwen';
  if (host.includes('volces') || host.includes('doubao') || model.startsWith('doubao')) return 'doubao';
  return 'openai';
}

/** 简历侧期望的 OpenAI-compatible root（常见需带 /v1）。 */
export function resumeSideBaseUrl(baseUrl: string, provider: ResumeAiProvider): string {
  const cleaned = baseUrl.trim().replace(/\/+$/, '');
  if (!cleaned) return cleaned;
  if (/\/v1$/i.test(cleaned) || /\/v1\//i.test(cleaned)) return cleaned.replace(/\/+$/, '');
  if (provider === 'deepseek' || provider === 'openai' || provider === 'qwen') {
    return `${cleaned}/v1`;
  }
  return cleaned;
}

function protocolFor(provider: ResumeAiProvider): 'chat-completions' | 'gemini' | 'anthropic' {
  if (provider === 'gemini') return 'gemini';
  if (provider === 'anthropic') return 'anthropic';
  return 'chat-completions';
}

function buildProfile(snapshot: PersonalApiConfigSnapshot) {
  const model = snapshot.modelType.trim();
  const provider = inferProvider(snapshot.baseUrl, model);
  const baseUrl = resumeSideBaseUrl(snapshot.baseUrl, provider);
  const builtin = provider === 'deepseek' ? DEEPSEEK_BUILTINS[model] : undefined;
  const id = builtin ? `builtin:${provider}:${builtin.id}` : `custom:${provider}:${model}`;
  const supportsPdf =
    builtin?.supportsPdf ??
    /vision|\bvl\b|multimodal|flash/i.test(model);
  return {
    id,
    provider,
    name: builtin?.name ?? model,
    apiKey: STUDYPILOT_MANAGED_API_KEY,
    model: builtin?.id ?? model,
    baseUrl,
    protocol: protocolFor(provider),
    supportsPdf,
    authMethod: 'api-key' as const,
    generation: 0,
    needsReauth: false,
  };
}

function writeStorage(payload: {
  models: ReturnType<typeof buildProfile>[];
  textModelId: string | null;
  pdfModelId: string | null;
}): void {
  try {
    window.localStorage.setItem(
      RESUME_AI_CONFIG_STORAGE_KEY,
      JSON.stringify({ state: payload, version: 2 }),
    );
  } catch {
    // 隐私模式 / 配额满时静默跳过；简历侧仍可能显示未配置。
  }
}

/** 清除简历侧 AI 配置（个人中心清除时调用）。 */
export function clearResumeAiConfig(): void {
  writeStorage({ models: [], textModelId: null, pdfModelId: null });
}

/**
 * 把个人中心已验证配置投影到简历侧 `ai-config-storage`。
 * 未验证或缺少模型时视为未配置并清空。
 */
export function syncResumeAiConfigFromPersonal(
  snapshot: PersonalApiConfigSnapshot | null,
): void {
  if (!snapshot || !snapshot.isVerified || !snapshot.modelType.trim() || !snapshot.baseUrl.trim()) {
    clearResumeAiConfig();
    return;
  }
  const profile = buildProfile(snapshot);
  writeStorage({
    models: [profile],
    textModelId: profile.id,
    pdfModelId: profile.supportsPdf ? profile.id : null,
  });
}