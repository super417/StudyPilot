import type { CreditModel } from './creditsApi';
import { platformProviderId } from './platformProviders';

export const CREDIT_SELECTION_CHANGED = 'studypilot:credit-selection-changed';

export function creditModelGroups(models: CreditModel[]) {
  const groups = [['deepseek', 'DeepSeek'], ['qwen', 'Qwen 系列'], ['kimi', 'Kimi'], ['minimax', 'MiniMax'], ['hunyuan', '混元'], ['mimo', 'MiMo']].map(([id, name]) => ({ id, name, models: [] as CreditModel[] }));
  for (const model of models) {
    const id = platformProviderId(model.provider);
    let group = groups.find((item) => item.id === id);
    if (!group) { group = { id, name: model.provider, models: [] }; groups.push(group); }
    group.models.push(model);
  }
  return groups;
}
