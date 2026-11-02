import type { CreditModel } from './creditsApi';
import { platformProviderId } from './platformProviders';

export const CREDIT_SELECTION_CHANGED = 'studypilot:credit-selection-changed';

export function creditModelLabel(model: CreditModel): string {
  if (model.id === 'credits:deepseek-flash') return 'DeepSeek-V4.1-Flash';
  return model.displayName;
}

export function creditModelGroups(models: CreditModel[]) {
  const groups = [
    { id: 'deepseek', name: 'DeepSeek', pending: ['DeepSeek-V4.1-Flash', 'DeepSeek-V4-Pro'] },
    { id: 'qwen', name: 'Qwen 系列', pending: ['Qwen3.5'] },
    { id: 'kimi', name: 'Kimi', pending: ['Kimi-K3.1-Pro', 'Kimi-K3', 'Kimi-K2.8-Preview'] },
    { id: 'minimax', name: 'MiniMax', pending: ['MiniMax-M3.1-Flash'] },
    { id: 'hunyuan', name: '混元', pending: ['Hy4 preview', 'Hy3'] },
    { id: 'mimo', name: 'MiMo', pending: ['Xiaomi MiMo-V2.6-Pro'] },
    { id: 'glm', name: 'GLM', pending: ['GLM-5.3', 'GLM-5.3-Flash', 'GLM-5.2'] },
    { id: 'space-bunny', name: 'Space-Bunny', pending: ['Space-Bunny'] },
    { id: 'step', name: 'Step', pending: ['Step-5-Preview'] },
  ].map((group) => ({ ...group, models: [] as CreditModel[] }));
  for (const model of models) {
    const id = platformProviderId(model.provider);
    let group = groups.find((item) => item.id === id);
    if (!group) { group = { id, name: model.provider, models: [], pending: [] }; groups.push(group); }
    group.models.push({ ...model, displayName: creditModelLabel(model) });
  }
  for (const group of groups) {
    group.pending = group.pending.filter((name) => !group.models.some((model) => model.displayName.toLowerCase() === name.toLowerCase()));
  }
  return groups;
}
