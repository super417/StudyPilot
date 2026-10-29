import type { BillingCatalog, PlatformModel } from './billingApi';
import type { BillingPreferenceDraft } from './billingViewState';

const PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', badge: 'D' },
  { id: 'qwen', name: '千问 Qwen', badge: 'Q' },
  { id: 'kimi', name: 'Kimi', badge: 'K' },
  { id: 'minimax', name: 'MiniMax', badge: 'M' },
  { id: 'hunyuan', name: '混元', badge: '混' },
  { id: 'mimo', name: 'MiMo', badge: 'Mi' },
] as const;

const ALIASES: Record<string, string> = {
  openai: 'openai', openaicompatible: 'openai', compatible: 'openai', 'openai兼容服务': 'openai', 'openai兼容': 'openai',
  gemini: 'gemini', google: 'gemini',
  deepseek: 'deepseek', '深度求索': 'deepseek',
  claude: 'claude', anthropic: 'claude',
  qwen: 'qwen', tongyi: 'qwen', dashscope: 'qwen', '千问': 'qwen', '通义千问': 'qwen',
  doubao: 'doubao', volcengine: 'doubao', bytedance: 'doubao', '豆包': 'doubao',
  orcarouter: 'orcarouter',
  kimi: 'kimi', moonshot: 'kimi', moonshotai: 'kimi', 'kimi.ai': 'kimi', '月之暗面': 'kimi',
  minimax: 'minimax', minimaxai: 'minimax',
  hunyuan: 'hunyuan', tencent: 'hunyuan', '混元': 'hunyuan', '腾讯混元': 'hunyuan',
  mimo: 'mimo', xiaomi: 'mimo', xiaomimimo: 'mimo', '小米': 'mimo', '小米mimo': 'mimo',
};

export function platformProviderId(provider: string): string {
  const value = provider.trim();
  return ALIASES[value.toLowerCase().replace(/[\s_/-]+/g, '')] ?? `other:${value.toLowerCase()}`;
}

export interface PlatformProviderGroup {
  id: string; name: string; badge: string; provider: string; models: PlatformModel[];
}

/** Presets are browsing categories. Only server catalog models make them usable. */
export function platformProviderGroups(models: PlatformModel[]): PlatformProviderGroup[] {
  const groups: PlatformProviderGroup[] = PRESETS.map((preset) => ({ ...preset, provider: preset.id, models: [] }));
  for (const model of models) {
    const id = platformProviderId(model.provider);
    let group = groups.find((item) => item.id === id);
    if (!group) {
      group = { id, name: model.provider, badge: '+', provider: model.provider, models: [] };
      groups.push(group);
    }
    group.models.push(model);
  }
  return groups;
}

/** Browsing never enables a paid preference without an actual priced model. */
export function canSavePlatformPreference(draft: BillingPreferenceDraft, catalog: BillingCatalog): boolean {
  if (draft.mode === 'byok') return true;
  if (!catalog.platformAvailable || !draft.provider) return false;
  const model = catalog.models.find((item) => item.id === draft.modelId && platformProviderId(item.provider) === platformProviderId(draft.provider));
  if (!model) return false;
  return [model.inputPricePerMillionYuan, model.outputPricePerMillionYuan].every((price) => typeof price === 'string' && /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(price) && Number.isFinite(Number(price)))
    && [model.maxInputTokens, model.maxOutputTokens].every((limit) => Number.isSafeInteger(limit) && limit > 0);
}
