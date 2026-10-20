/**
 * 首次打开聊天时的起名条：可跳过，不禁用输入/发送。
 * ChatWindow（小窗）与 ChatPanel（全屏）共用，勿复制两份。
 *
 * 显示前会经共享的 fetchBasicProfile 核对服务端；本地缓存空不等于要弹窗。
 */
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/httpClient';
import { resolveAssistantNameGate } from '@/lib/assistantNamePromptGate';
import {
  displayAssistantName,
  fetchBasicProfile,
  getBasicProfile,
  hasSkippedAssistantName,
  saveAssistantName,
  setSkippedAssistantName,
} from '@/lib/profilePrefs';

export interface AssistantNamePromptProps {
  /** 聊天面板是否已打开（小窗看 store.open；全屏面板挂载即 true） */
  active: boolean;
  /** 起名成功、跳过、或核对到服务端已有名字时，通知父级刷新标题 */
  onResolved?: (assistantName: string) => void;
}

type Gate = 'idle' | 'checking' | 'prompt' | 'done';

/** 纯展示层：便于交互测试在不跑 useEffect 的情况下驱动按钮。 */
export function AssistantNamePromptView({
  draft,
  saving,
  error,
  onDraftChange,
  onSave,
  onSkip,
}: {
  draft: string;
  saving: boolean;
  error: string | null;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onSkip: () => void;
}) {
  return (
    <div
      className="shrink-0 border-b border-brandFaint/80 bg-brandFaint/40 px-4 py-3"
      data-testid="assistant-name-prompt"
    >
      <p className="text-sm font-medium text-brandDark">
        给你的学伴起个名字？
      </p>
      <p className="mt-0.5 text-xs text-brandDark/60">
        可不填；跳过后用「{displayAssistantName('')}」。不会影响聊天。
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={draft}
          maxLength={32}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="例如：小航"
          aria-label="助手名字"
          className="min-w-0 flex-1 rounded-full border border-brandFaint bg-white px-3 py-1.5 text-sm text-brandDark outline-none focus:border-brand"
        />
        <button
          type="button"
          disabled={saving}
          onClick={onSave}
          className="rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
        >
          {saving ? '保存中…' : '就叫这个'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onSkip}
          className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-brandDark ring-1 ring-brandFaint disabled:opacity-60"
        >
          跳过
        </button>
      </div>
      {error ? (
        <p className="mt-1.5 text-xs text-red-600" data-testid="assistant-name-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AssistantNamePrompt({ active, onResolved }: AssistantNamePromptProps) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<Gate>('idle');
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;

  useEffect(() => {
    if (!active) {
      setGate('idle');
      return;
    }

    let cancelled = false;
    setGate('checking');

    void resolveAssistantNameGate({
      active: true,
      hasSkipped: hasSkippedAssistantName,
      getLocal: getBasicProfile,
      fetchProfile: fetchBasicProfile,
    }).then((result) => {
      if (cancelled) return;
      if (result.action === 'hide') {
        setGate('done');
        setError(null);
        onResolvedRef.current?.(result.assistantName);
        return;
      }
      setGate('prompt');
    });

    return () => {
      cancelled = true;
    };
  }, [active]);

  const handleSkip = () => {
    setSkippedAssistantName(true);
    setGate('done');
    setError(null);
    onResolvedRef.current?.('');
  };

  const handleSave = async () => {
    if (saving) return;
    const name = draft.trim();
    if (!name) {
      setError('请输入名字，或点「跳过」');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveAssistantName(name);
      setGate('done');
      onResolvedRef.current?.(saved.assistantName);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  if (!active || gate !== 'prompt') return null;

  return (
    <AssistantNamePromptView
      draft={draft}
      saving={saving}
      error={error}
      onDraftChange={setDraft}
      onSave={() => void handleSave()}
      onSkip={handleSkip}
    />
  );
}

export default AssistantNamePrompt;
