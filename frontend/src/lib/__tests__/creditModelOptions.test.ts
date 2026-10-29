import { describe, it, expect, vi } from 'vitest';
import { creditModelGroups, CREDIT_SELECTION_CHANGED } from '../creditModelOptions';
import { saveCreditPreferences } from '../creditsApi';
import { apiRequest } from '../httpClient';
vi.mock('../httpClient', () => ({ apiRequest: vi.fn() }));

describe('积分目录与双入口同步', () => {
  it('空目录仍有六类，但不制造可用模型', () => {
    const groups = creditModelGroups([]);
    expect(groups.map((g) => g.name)).toEqual(['DeepSeek', 'Qwen 系列', 'Kimi', 'MiniMax', '混元', 'MiMo']);
    expect(groups.every((g) => g.models.length === 0)).toBe(true);
  });
  it('只归组真实积分目录，保留供应商别名及未知模型ID', () => {
    const base = { inputPointsPerMillion: '40', outputPointsPerMillion: '160', maxInputTokens: 10, maxOutputTokens: 10 };
    const rows = [{ ...base, id: 'credits:exact', provider: 'Moonshot', displayName: '目录模型' }, { ...base, id: 'opaque-id', provider: 'Private', displayName: '私有模型' }];
    const groups = creditModelGroups(rows);
    expect(groups.find((g) => g.id === 'kimi')?.models[0]).toEqual(rows[0]);
    expect(groups[6].models[0].id).toBe('opaque-id');
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
