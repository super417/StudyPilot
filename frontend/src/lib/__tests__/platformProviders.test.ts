import { describe, expect, it } from 'vitest';
import type { BillingAccount, BillingCatalog, PlatformModel } from '../billingApi';
import { reconcileBillingDraft } from '../billingViewState';
import { canSavePlatformPreference, platformProviderGroups, platformProviderId } from '../platformProviders';

const model = (provider: string, id = provider): PlatformModel => ({ id, provider, displayName: `目录模型 ${id}`, inputPricePerMillionYuan: '1.5', outputPricePerMillionYuan: '3', maxInputTokens: 1000, maxOutputTokens: 1000 });
const empty: BillingCatalog = { status: 'ok', models: [], platformAvailable: false, channels: [], supportedCapabilities: [] };

describe('平台供应商浏览与真实目录边界', () => {
  it('空目录展示指定六个分类，但不能保存平台模式', () => {
    const groups = platformProviderGroups([]);
    expect(groups.map((item) => item.id)).toEqual(['deepseek', 'qwen', 'kimi', 'minimax', 'hunyuan', 'mimo']);
    expect(groups.every((item) => item.models.length === 0)).toBe(true);
    for (const group of groups) expect(canSavePlatformPreference({ mode: 'platform', provider: group.provider, modelId: '' }, empty)).toBe(false);
  });
  it('Kimi、MiniMax、混元和MiMo别名归入指定分类且保留真实模型', () => {
    const aliases: Record<string, string[]> = { kimi: ['Moonshot', 'moonshot-ai', 'KIMI', '月之暗面'], minimax: ['MiniMax', 'minimax-ai'], hunyuan: ['Tencent', 'HUNYUAN', '腾讯混元'], mimo: ['Xiaomi', 'MiMo', 'xiaomi-mimo'] };
    const models = Object.values(aliases).flat().map((provider, index) => model(provider, `real-${index}`));
    const groups = platformProviderGroups(models);
    expect(groups).toHaveLength(6);
    for (const [id, providers] of Object.entries(aliases)) {
      for (const provider of providers) expect(platformProviderId(provider)).toBe(id);
      expect(groups.find((group) => group.id === id)?.models.map((item) => item.provider)).toEqual(providers);
    }
  });
  it('大小写、兼容服务及常见别名归组，保留原始服务端模型ID', () => {
    const models = [model('OpenAI-compatible', 'exact-1'), model('OPENAI', 'exact-2'), model('Tongyi', 'exact-3'), model('Qwen', 'exact-4'), model('Anthropic', 'exact-5'), model('Google', 'exact-6'), model('豆包', 'exact-7')];
    const groups = platformProviderGroups(models);
    expect(groups.find((item) => item.id === 'openai')?.models.map((item) => item.id)).toEqual(['exact-1', 'exact-2']);
    expect(groups.find((item) => item.id === 'qwen')?.models.map((item) => item.id)).toEqual(['exact-3', 'exact-4']);
    expect(groups.find((item) => item.id === 'claude')?.models[0].id).toBe('exact-5');
    expect(groups.find((item) => item.id === 'gemini')?.models[0].id).toBe('exact-6');
    expect(groups.find((item) => item.id === 'doubao')?.models[0].id).toBe('exact-7');
    expect(platformProviderId('DeepSeek')).toBe('deepseek');
    expect(platformProviderId('OrcaRouter')).toBe('orcarouter');
  });
  it('不熟悉的真实供应商保留为可选分类，不擅自改名或丢模型', () => {
    const configured = model('My Private Gateway', 'opaque-model-id');
    const groups = platformProviderGroups([configured]);
    expect(groups).toHaveLength(7);
    expect(groups[6].provider).toBe('My Private Gateway');
    expect(groups[6].models[0]).toEqual(configured);
    expect(canSavePlatformPreference({ mode: 'platform', provider: groups[6].provider, modelId: configured.id }, { ...empty, models: [configured], platformAvailable: true })).toBe(true);
  });
  it('自带Key配置不成为平台模型，平台目录为空时仍不能启用', () => {
    const byok = { provider: 'DeepSeek', verified: true };
    expect(platformProviderGroups(empty.models).find((item) => item.id === platformProviderId(byok.provider))?.models).toEqual([]);
    expect(canSavePlatformPreference({ mode: 'platform', provider: byok.provider, modelId: 'byok-model' }, empty)).toBe(false);
    expect(canSavePlatformPreference({ mode: 'byok', provider: '', modelId: '' }, empty)).toBe(true);
  });
  it('仅允许选中分类的真实、有价目模型保存，恢复已保存别名时模型ID不变', () => {
    const configured = model('Anthropic', 'server-model-42');
    const catalog = { ...empty, platformAvailable: true, models: [configured] };
    const account: BillingAccount = { status: 'ok', mode: 'platform', modelId: configured.id, balanceMicros: 0, reservedMicros: 0, availableMicros: 0, ledger: [], orders: [] };
    const draft = reconcileBillingDraft({ mode: 'byok', provider: '', modelId: '' }, account, catalog.models, false);
    expect(draft.modelId).toBe('server-model-42');
    expect(platformProviderId(draft.provider)).toBe('claude');
    expect(canSavePlatformPreference(draft, catalog)).toBe(true);
    expect(canSavePlatformPreference({ ...draft, provider: 'qwen' }, catalog)).toBe(false);
    expect(canSavePlatformPreference(draft, { ...catalog, models: [{ ...configured, inputPricePerMillionYuan: '' }] })).toBe(false);
    expect(canSavePlatformPreference(draft, { ...catalog, models: [{ ...configured, inputPricePerMillionYuan: '1E-7' }] })).toBe(true);
    const editing = { ...draft, provider: 'gemini', modelId: '' };
    expect(reconcileBillingDraft(editing, account, catalog.models, true)).toEqual(editing);
  });
});
