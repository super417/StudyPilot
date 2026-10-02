/**
 * 模型选择与推理强度偏好。
 *
 * 模型 ID 来自用户 API 的 /models 列表（动态）。
 * 推理强度保存在本地，并在助手对话 / 规划请求中透传给后端生效。
 *
 * 安全：此处仅存储「模型代号」与「强度档位」这类非敏感偏好，
 * 绝不存储 apiKey 等任何凭据。
 */

/** 模型代号：与供应商返回的 model id / modelType 一致。 */
export type ModelId = string;

/** 推理强度四档。 */
export type StrengthId = 'low' | 'standard' | 'high' | 'deep';

/** 单个模型选项的展示配置。 */
export interface ModelOption {
  id: ModelId;
  /** 展示名称 */
  label: string;
}

/** 单个强度档位的展示配置。 */
export interface StrengthOption {
  id: StrengthId;
  /** 档位名称 */
  label: string;
  /** 一句话说明 */
  description: string;
}

/** 模型偏好整体。 */
export interface ModelPrefs {
  model: ModelId;
  strength: StrengthId;
}

/** 推理强度档位（离散四档，含说明）。 */
export const STRENGTH_OPTIONS: readonly StrengthOption[] = [
  { id: 'low', label: '低', description: '最快响应，适合简单问答与草稿' },
  { id: 'standard', label: '标准', description: '速度与质量均衡，日常学习推荐' },
  { id: 'high', label: '高', description: '更充分的推理，适合复杂题目讲解' },
  { id: 'deep', label: '深度', description: '最大化推理深度，耗时更长，适合难题攻坚' },
];

const DEFAULT_PREFS: ModelPrefs = { model: '', strength: 'standard' };

const STORAGE_KEY = 'studypilot.modelPrefs.v1';

const STRENGTH_IDS = new Set<StrengthId>(STRENGTH_OPTIONS.map((o) => o.id));

function isStrengthId(value: unknown): value is StrengthId {
  return typeof value === 'string' && STRENGTH_IDS.has(value as StrengthId);
}

/** 读取模型偏好；缺失或损坏时回落到默认值（类型安全，不抛异常）。 */
export function getModelPrefs(): ModelPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<ModelPrefs>;
    const model =
      typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : DEFAULT_PREFS.model;
    return {
      model,
      strength: isStrengthId(parsed.strength) ? parsed.strength : DEFAULT_PREFS.strength,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writePrefs(prefs: ModelPrefs): ModelPrefs {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage 不可用（隐私模式/配额）时静默降级：本次会话内偏好仍生效。
  }
  return prefs;
}

/** 设置模型并持久化，返回最新完整偏好。 */
export function setModel(model: ModelId): ModelPrefs {
  return writePrefs({ ...getModelPrefs(), model });
}

/** 设置推理强度并持久化，返回最新完整偏好。 */
export function setStrength(strength: StrengthId): ModelPrefs {
  return writePrefs({ ...getModelPrefs(), strength });
}

/** 取模型展示名（无映射时原样返回 id）。 */
export function getModelLabel(id: ModelId, options?: readonly ModelOption[]): string {
  if (!id) return '请选择模型';
  const fromOptions = options?.find((o) => o.id === id)?.label;
  return fromOptions ?? id;
}

/** 取强度档位配置。 */
export function getStrengthOption(id: StrengthId): StrengthOption {
  return STRENGTH_OPTIONS.find((o) => o.id === id) ?? STRENGTH_OPTIONS[1];
}
