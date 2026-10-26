import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  store: new Map<string, string>(),
}));

vi.stubGlobal('localStorage', {
  getItem: (key: string) => mocks.store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    mocks.store.set(key, value);
  },
  removeItem: (key: string) => {
    mocks.store.delete(key);
  },
  clear: () => {
    mocks.store.clear();
  },
  key: () => null,
  get length() {
    return mocks.store.size;
  },
});

vi.mock('@/lib/httpClient', () => ({
  apiRequest: mocks.apiRequest,
  ApiError: class ApiError extends Error {
    constructor(message: string) {
      super(message);
    }
    name = 'ApiError';
  },
}));

import {
  ASSISTANT_NAME_SKIPPED_KEY,
  DEFAULT_ASSISTANT_LABEL,
  displayAssistantName,
  fetchBasicProfile,
  getBasicProfile,
  hasSkippedAssistantName,
  saveAssistantName,
  saveBasicProfile,
  setSkippedAssistantName,
} from '@/lib/profilePrefs';

describe('profilePrefs assistantName', () => {
  beforeEach(() => {
    mocks.store.clear();
    vi.clearAllMocks();
  });

  it('displayAssistantName falls back to 你的学伴', () => {
    expect(displayAssistantName('')).toBe(DEFAULT_ASSISTANT_LABEL);
    expect(displayAssistantName('  ')).toBe(DEFAULT_ASSISTANT_LABEL);
    expect(displayAssistantName('小航')).toBe('小航');
  });

  it('normalize / save round-trip keeps assistantName', async () => {
    mocks.apiRequest.mockResolvedValue({
      status: 'ok',
      profile: {
        nickname: '小明',
        direction: 'AI',
        targetSchool: '',
        bio: '',
        assistantName: '小航',
      },
    });
    const saved = await saveBasicProfile({
      nickname: '小明',
      direction: 'AI',
      targetSchool: '',
      school: '',
      major: '',
      bio: '',
      assistantName: '小航',
    });
    expect(saved.assistantName).toBe('小航');
    expect(getBasicProfile().assistantName).toBe('小航');
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/api/profile',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"assistantName":"小航"'),
      }),
    );
  });

  it('legacy migration PUT keeps server assistantName in full five-field body', async () => {
    mocks.apiRequest
      .mockResolvedValueOnce({
        status: 'ok',
        profile: {
          nickname: '',
          direction: '',
          targetSchool: '',
          bio: '',
          assistantName: '服务端学伴',
        },
      })
      .mockResolvedValueOnce({
        status: 'ok',
        profile: {
          nickname: '旧昵称',
          direction: '旧方向',
          targetSchool: '',
          bio: '',
          assistantName: '服务端学伴',
        },
      });
    mocks.store.set(
      'studypilot.basicProfile.v1',
      JSON.stringify({
        nickname: '旧昵称',
        direction: '旧方向',
        targetSchool: '',
        bio: '',
        assistantName: '',
      }),
    );

    const profile = await fetchBasicProfile();
    expect(profile.nickname).toBe('旧昵称');
    expect(profile.assistantName).toBe('服务端学伴');
    expect(mocks.apiRequest).toHaveBeenCalledTimes(2);

    const putCall = mocks.apiRequest.mock.calls.find(
      (call) => call[1] && (call[1] as { method?: string }).method === 'PUT',
    );
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String((putCall?.[1] as { body: string }).body)) as Record<
      string,
      string
    >;
    expect(body).toEqual({
      nickname: '旧昵称',
      direction: '旧方向',
      targetSchool: '',
      school: '',
      major: '',
      bio: '',
      assistantName: '服务端学伴',
    });
  });

  it('saveAssistantName preserves school and major when updating the name', async () => {
    mocks.apiRequest
      .mockResolvedValueOnce({
        status: 'ok',
        profile: {
          nickname: '小明',
          direction: 'AI',
          targetSchool: '某处',
          school: '上海财经大学（示例，待确认）',
          major: '统计学（示例，待确认）',
          bio: '简介',
          assistantName: '',
        },
      })
      .mockResolvedValueOnce({
        status: 'ok',
        profile: {
          nickname: '小明',
          direction: 'AI',
          targetSchool: '某处',
          school: '上海财经大学（示例，待确认）',
          major: '统计学（示例，待确认）',
          bio: '简介',
          assistantName: '小航',
        },
      });

    mocks.store.set(ASSISTANT_NAME_SKIPPED_KEY, '1');
    const saved = await saveAssistantName('小航');
    expect(saved.assistantName).toBe('小航');
    expect(hasSkippedAssistantName()).toBe(false);

    const putCall = mocks.apiRequest.mock.calls.find(
      (call) => call[1] && (call[1] as { method?: string }).method === 'PUT',
    );
    const body = JSON.parse(String((putCall?.[1] as { body: string }).body));
    expect(body).toEqual({
      nickname: '小明',
      direction: 'AI',
      targetSchool: '某处',
      school: '上海财经大学（示例，待确认）',
      major: '统计学（示例，待确认）',
      bio: '简介',
      assistantName: '小航',
    });
  });

  it('concurrent fetchBasicProfile shares one GET', async () => {
    let resolveGet: (value: unknown) => void = () => {};
    mocks.apiRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveGet = resolve;
        }),
    );
    const a = fetchBasicProfile();
    const b = fetchBasicProfile();
    resolveGet({
      status: 'ok',
      profile: {
        nickname: '',
        direction: '',
        targetSchool: '',
        bio: '',
        assistantName: '共享',
      },
    });
    const [pa, pb] = await Promise.all([a, b]);
    expect(pa.assistantName).toBe('共享');
    expect(pb.assistantName).toBe('共享');
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
  });

  it('skip flag read/write', () => {
    expect(hasSkippedAssistantName()).toBe(false);
    setSkippedAssistantName(true);
    expect(mocks.store.get(ASSISTANT_NAME_SKIPPED_KEY)).toBe('1');
    expect(hasSkippedAssistantName()).toBe(true);
    setSkippedAssistantName(false);
    expect(hasSkippedAssistantName()).toBe(false);
  });
});
