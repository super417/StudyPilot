import { describe, it, expect, vi } from 'vitest';
import { creditModelGroups, CREDIT_SELECTION_CHANGED } from '../creditModelOptions';
import { saveCreditPreferences } from '../creditsApi';
import { apiRequest } from '../httpClient';
vi.mock('../httpClient', () => ({ apiRequest: vi.fn() }));

describe('积分目录与双入口同步', () => {
  it('目录开放 Flash 和 Pro 后均显示可选项，没有 DeepSeek 待接入项', () => {
    const base = { provider: 'deepseek', inputPointsPerMillion: '40', outputPointsPerMillion: '160', maxInputTokens: 16000, maxOutputTokens: 4096 };
    const group = creditModelGroups([
      { ...base, id: 'credits:deepseek-flash', displayName: 'DeepSeek-V4.1-Flash' },
      { ...base, id: 'credits:deepseek-v4-pro', displayName: 'DeepSeek-V4-Pro' },
    ]).find((g) => g.id === 'deepseek')!;
    expect(group.models.map((m) => m.id)).toEqual(['credits:deepseek-flash', 'credits:deepseek-v4-pro']);
    expect(group.pending).toEqual([]);
  });
  it('旧目录中的 Flash 名称按模型 ID 归一，不重复显示待接入', () => {
    const model = { id: 'credits:deepseek-flash', provider: 'deepseek', displayName: 'DeepSeek Flash', inputPointsPerMillion: '40', outputPointsPerMillion: '160', maxInputTokens: 16000, maxOutputTokens: 4096 };
    const group = creditModelGroups([model]).find((g) => g.id === 'deepseek')!;
    expect(group.models[0]).toEqual({ ...model, displayName: 'DeepSeek-V4.1-Flash' });
    expect(group.pending).toEqual(['DeepSeek-V4-Pro']);
    expect(model.displayName).toBe('DeepSeek Flash');
  });
  it('空目录仍显示具体型号供浏览', () => {
    const groups = creditModelGroups([]);
    expect(groups.find((g) => g.id === 'kimi')?.pending).toContain('Kimi-K3.1-Pro');
    expect(groups.every((g) => g.models.length === 0)).toBe(true);
  });
  it('只归组真实积分目录，保留供应商别名及未知模型ID', () => {
    const base = { inputPointsPerMillion: '40', outputPointsPerMillion: '160', maxInputTokens: 10, maxOutputTokens: 10 };
    const rows = [{ ...base, id: 'credits:exact', provider: 'Moonshot', displayName: '目录模型' }, { ...base, id: 'opaque-id', provider: 'Private', displayName: '私有模型' }];
    const groups = creditModelGroups(rows);
    expect(groups.find((g) => g.id === 'kimi')?.models[0]).toEqual(rows[0]);
    expect(groups.find((g) => g.name === 'Private')?.models[0].id).toBe('opaque-id');
    expect(groups.find((g) => g.id === 'deepseek')?.models).toEqual([]);
  });
  it('服务端保存成功才通知两个入口刷新；失败不通知或fallback', async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    try {
      vi.mocked(apiRequest).mockResolvedValueOnce({ status: 'ok' });
      await saveCreditPreferences('platform', 'credits:exact');
      expect(dispatchEvent.mock.calls[0][0].type).toBe(CREDIT_SELECTION_CHANGED);
      vi.mocked(apiRequest).mockRejectedValueOnce(new Error('unavailable'));
      await expect(saveCreditPreferences('platform', 'pending:qwen')).rejects.toThrow('unavailable');
      expect(dispatchEvent).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
});
