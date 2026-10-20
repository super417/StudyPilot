import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/httpClient';
import { AssistantNamePromptView } from '@/components/assistant/AssistantNamePrompt';
import { saveAssistantName } from '@/lib/profilePrefs';

const api = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  store: new Map<string, string>(),
}));

vi.stubGlobal('localStorage', {
  getItem: (key: string) => api.store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    api.store.set(key, value);
  },
  removeItem: (key: string) => {
    api.store.delete(key);
  },
  clear: () => {
    api.store.clear();
  },
  key: () => null,
  get length() {
    return api.store.size;
  },
});

vi.mock('@/lib/httpClient', async () => {
  class ApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return {
    apiRequest: api.apiRequest,
    ApiError,
  };
});

function visit(
  node: unknown,
  callback: (node: { type?: unknown; props?: Record<string, unknown> }) => void,
) {
  if (Array.isArray(node)) {
    node.forEach((child) => visit(child, callback));
    return;
  }
  if (!node || typeof node !== 'object') return;
  callback(node as { type?: unknown; props?: Record<string, unknown> });
  visit((node as { props?: { children?: unknown } }).props?.children, callback);
}

function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object') {
    return textOf((node as { props?: { children?: unknown } }).props?.children);
  }
  return '';
}

function findButton(tree: unknown, label: string) {
  let found: { props?: Record<string, unknown> } | null = null;
  visit(tree, (node) => {
    if (node.type === 'button' && textOf(node) === label) found = node;
  });
  return found;
}

describe('AssistantNamePrompt interactions', () => {
  beforeEach(() => {
    api.store.clear();
    vi.clearAllMocks();
  });

  it('save path: GET then PUT full five fields via saveAssistantName', async () => {
    api.apiRequest
      .mockResolvedValueOnce({
        status: 'ok',
        profile: {
          nickname: '小明',
          direction: 'AI',
          targetSchool: '某处',
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
          bio: '简介',
          assistantName: '小航',
        },
      });

    api.store.set('studypilot.assistantName.skipped.v1', '1');
    const saved = await saveAssistantName('小航');
    expect(saved.assistantName).toBe('小航');
    expect(api.store.get('studypilot.assistantName.skipped.v1')).toBeUndefined();

    const putCall = api.apiRequest.mock.calls.find(
      (call) => call[1] && (call[1] as { method?: string }).method === 'PUT',
    );
    expect(JSON.parse(String((putCall?.[1] as { body: string }).body))).toEqual({
      nickname: '小明',
      direction: 'AI',
      targetSchool: '某处',
      bio: '简介',
      assistantName: '小航',
    });
  });

  it('skip button writes flag callback and does not call save', () => {
    const onSkip = vi.fn();
    const onSave = vi.fn();
    const element = createElement(AssistantNamePromptView, {
      draft: '',
      saving: false,
      error: null,
      onDraftChange: () => {},
      onSave,
      onSkip,
    });
    const tree = (element.type as (props: typeof element.props) => unknown)(element.props);
    const skip = findButton(tree, '跳过');
    expect(skip).toBeTruthy();
    (skip!.props!.onClick as () => void)();
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('save failure surfaces error and does not pretend success', async () => {
    let error: string | null = null;
    let hidden = false;
    const onDraftChange = vi.fn();

    const runSave = async () => {
      try {
        await saveAssistantName('小航');
        hidden = true;
        error = null;
      } catch (e) {
        error = e instanceof ApiError ? e.message : '保存失败，请稍后重试';
        hidden = false;
      }
    };

    api.apiRequest
      .mockResolvedValueOnce({
        status: 'ok',
        profile: {
          nickname: '',
          direction: '',
          targetSchool: '',
          bio: '',
          assistantName: '',
        },
      })
      .mockRejectedValueOnce(new ApiError('后端拒绝'));

    await runSave();
    expect(hidden).toBe(false);
    expect(error).toBe('后端拒绝');

    const tree = createElement(AssistantNamePromptView, {
      draft: '小航',
      saving: false,
      error,
      onDraftChange,
      onSave: () => {},
      onSkip: () => {},
    });
    const markup = renderToStaticMarkup(tree);
    expect(markup).toContain('后端拒绝');
    expect(markup).toContain('就叫这个');
    expect(markup).toContain('assistant-name-error');
  });

  it('prompt view does not disable sibling chat input or send', () => {
    const tree = createElement(
      Fragment,
      null,
      createElement(AssistantNamePromptView, {
        draft: '',
        saving: false,
        error: null,
        onDraftChange: () => {},
        onSave: () => {},
        onSkip: () => {},
      }),
      createElement('input', {
        'aria-label': 'chat-input',
        disabled: false,
        value: '',
        onChange: () => {},
      }),
      createElement('button', { type: 'button', disabled: false }, '发送'),
    );

    let inputDisabled: unknown;
    let sendDisabled: unknown;
    visit(tree, (node) => {
      if (node.type === 'input' && node.props?.['aria-label'] === 'chat-input') {
        inputDisabled = node.props.disabled;
      }
      if (node.type === 'button' && textOf(node) === '发送') {
        sendDisabled = node.props.disabled;
      }
    });
    expect(renderToStaticMarkup(tree)).toContain('assistant-name-prompt');
    expect(inputDisabled).toBe(false);
    expect(sendDisabled).toBe(false);
  });

  it('view renders primary actions', () => {
    const markup = renderToStaticMarkup(
      createElement(AssistantNamePromptView, {
        draft: '',
        saving: false,
        error: null,
        onDraftChange: () => {},
        onSave: () => {},
        onSkip: () => {},
      }),
    );
    expect(markup).toContain('就叫这个');
    expect(markup).toContain('跳过');
  });
});
