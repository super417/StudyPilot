import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();

vi.stubGlobal('window', {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  },
});

import {
  RESUME_AI_CONFIG_STORAGE_KEY,
  STUDYPILOT_MANAGED_API_KEY,
  syncResumeAiConfigFromPersonal,
  syncResumeAiConfigFromPlatform,
} from '@/lib/resumeAiConfigBridge';

function readStorage() {
  const raw = storage.get(RESUME_AI_CONFIG_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function seedRealKey() {
  storage.set(
    RESUME_AI_CONFIG_STORAGE_KEY,
    JSON.stringify({
      state: {
        models: [
          {
            id: 'custom:deepseek:real',
            apiKey: 'sk-real-independent-key',
            model: 'deepseek-chat',
            provider: 'deepseek',
          },
        ],
        textModelId: 'custom:deepseek:real',
        pdfModelId: null,
      },
      version: 2,
    }),
  );
}

describe('resumeAiConfigBridge', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('平台无 BYOK 仍生成 managed 哨兵 + DeepSeek 展示 profile', () => {
    syncResumeAiConfigFromPlatform('credits:deepseek-flash');

    const data = readStorage();
    expect(data.state.models).toHaveLength(1);
    const model = data.state.models[0];
    expect(model.apiKey).toBe(STUDYPILOT_MANAGED_API_KEY);
    expect(model.model).toBe('deepseek-flash');
    expect(model.provider).toBe('deepseek');
    expect(data.state.textModelId).toBe(model.id);
  });

  it('平台 v4-pro 投影为 deepseek-v4-pro', () => {
    syncResumeAiConfigFromPlatform('credits:deepseek-v4-pro');

    const data = readStorage();
    expect(data.state.models[0].model).toBe('deepseek-v4-pro');
    expect(data.state.models[0].apiKey).toBe(STUDYPILOT_MANAGED_API_KEY);
  });

  it('平台未知模型 id 时清空', () => {
    syncResumeAiConfigFromPlatform('credits:unknown');

    const data = readStorage();
    expect(data.state.models).toHaveLength(0);
    expect(data.state.textModelId).toBeNull();
  });

  it('byok 原行为：个人中心配置投影为 managed 哨兵', () => {
    syncResumeAiConfigFromPersonal({
      modelType: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com',
      isVerified: true,
    });

    const data = readStorage();
    expect(data.state.models).toHaveLength(1);
    expect(data.state.models[0].apiKey).toBe(STUDYPILOT_MANAGED_API_KEY);
    expect(data.state.models[0].model).toBe('deepseek-chat');
  });

  it('平台投影不覆盖已存在的非哨兵真实 Key 独立配置', () => {
    seedRealKey();

    syncResumeAiConfigFromPlatform('credits:deepseek-flash');

    const data = readStorage();
    expect(data.state.models).toHaveLength(1);
    expect(data.state.models[0].apiKey).toBe('sk-real-independent-key');
    expect(data.state.models[0].id).toBe('custom:deepseek:real');
  });

  it('byok 投影不覆盖已存在的非哨兵真实 Key 独立配置', () => {
    seedRealKey();

    syncResumeAiConfigFromPersonal({
      modelType: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com',
      isVerified: true,
    });

    const data = readStorage();
    expect(data.state.models[0].apiKey).toBe('sk-real-independent-key');
  });
});
