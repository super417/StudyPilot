import { useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import DocumentPicker from './DocumentPicker';
import { useDocumentsStore } from '@/store/documentsStore';
import { usePlanSessionStore } from '@/store/planSessionStore';
import { useAssistantStore } from '@/store';
import {
  planStartQuestion,
  streamPlanClarify,
  streamPlanGenerate,
  type PlanGoalFields,
} from '@/lib/plansApi';
import { ApiError } from '@/lib/httpClient';
import { validateGoalDraft } from '@/lib/goalDraft';

export interface PlanGeneratePayload {
  goalName: string;
  goalDate: string;
  currentLevel: string;
  dailyMinutes: number;
  completionCriterion: string;
  documentIds: string[];
}

export interface GoalSubmitFormProps {
  onSubmitPayload?: (payload: PlanGeneratePayload) => void;
  /** 仅收起计划表单，不关闭聊天窗 */
  onDismiss?: () => void;
}

function GoalSubmitForm({ onSubmitPayload, onDismiss }: GoalSubmitFormProps) {
  const getSelectedDocumentIds = useDocumentsStore((s) => s.getSelectedDocumentIds);
  const markSkipped = useDocumentsStore((s) => s.markSkipped);
  const draftId = usePlanSessionStore((s) => s.draftId);
  const clarifyQuestion = usePlanSessionStore((s) => s.clarifyQuestion);
  const setClarify = usePlanSessionStore((s) => s.setClarify);
  const clearClarify = usePlanSessionStore((s) => s.clearClarify);
  const setLastPlanId = usePlanSessionStore((s) => s.setLastPlanId);
  const setActivePlanId = usePlanSessionStore((s) => s.setActivePlanId);
  const setPreview = usePlanSessionStore((s) => s.setPreview);

  const addMessage = useAssistantStore((s) => s.addMessage);
  const appendStreamChunk = useAssistantStore((s) => s.appendStreamChunk);
  const setStreaming = useAssistantStore((s) => s.setStreaming);
  const stopStreaming = useAssistantStore((s) => s.stopStreaming);
  const streaming = useAssistantStore((s) => s.streaming);

  const [goalName, setGoalName] = useState('');
  const [goalDate, setGoalDate] = useState('');
  const [currentLevel, setCurrentLevel] = useState('');
  const [dailyMinutes, setDailyMinutes] = useState('120');
  const [completionCriterion, setCompletionCriterion] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const pushAssistant = (content: string) => {
    addMessage({
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'assistant',
      content,
    });
  };

  const typewrite = async (text: string, signal: AbortSignal) => {
    setStreaming(true);
    for (const ch of text) {
      if (signal.aborted) break;
      appendStreamChunk(ch);
      await new Promise((r) => setTimeout(r, 12));
    }
    stopStreaming();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (streaming) return;

    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const checked = validateGoalDraft({
      goalName,
      goalDate,
      currentLevel,
      dailyMinutes,
      completionCriterion,
      today: todayIso,
    });
    if (!checked.ok) {
      setHint(checked.hint);
      return;
    }

    const payload: PlanGeneratePayload = {
      ...checked.value,
      documentIds: getSelectedDocumentIds(),
    };

    if (onSubmitPayload) {
      onSubmitPayload(payload);
      return;
    }

    setHint(null);
    const docs =
      payload.documentIds.length > 0
        ? `已选 ${payload.documentIds.length} 份资料`
        : '未选资料';
    addMessage({
      id: `u-plan-${Date.now()}`,
      role: 'user',
      content: `【学习目标】${payload.goalName}｜期限 ${payload.goalDate}｜基础 ${payload.currentLevel}｜每日 ${payload.dailyMinutes} 分钟｜完成标准 ${payload.completionCriterion}｜${docs}`,
    });

    const fields: PlanGoalFields = { ...payload };
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStreaming(true);

    let summary: string | null = null;

    const handlers = {
      onStatus: (text: string) => pushAssistant(text),
      onClarify: (data: {
        draftId: string;
        round: number;
        missing: string[];
        question: string;
      }) => {
        setClarify(data.draftId, data.question);
        pushAssistant(
          `追问（第 ${data.round} 轮）：${data.question}${
            data.missing.length ? `\n待补充：${data.missing.join('、')}` : ''
          }`,
        );
      },
      onNotice: (data: { message?: string; skippedDocs?: string[] }) => {
        if (data.skippedDocs?.length) markSkipped(data.skippedDocs);
        if (data.message) pushAssistant(`提示：${data.message}`);
      },
      onPreview: (data: { draftId: string; summary: string }) => {
        setPreview(data.draftId);
        pushAssistant(data.summary);
      },
      onDone: (data: { planId: string; phases: number; usedDocs: string[] }) => {
        clearClarify();
        setLastPlanId(data.planId);
        setActivePlanId(data.planId);
        usePlanSessionStore.getState().askForStart();
        const used =
          data.usedDocs.length > 0
            ? `已参考 ${data.usedDocs.length} 份资料`
            : '这次没有使用资料依据';
        summary = `规划已生成，共 ${data.phases} 个阶段。${used}。\n${planStartQuestion()}`;
        onDismiss?.();
      },
      onError: (data: { code: string; message: string }) => {
        pushAssistant(`规划失败（${data.code}）：${data.message}`);
      },
    };

    try {
      if (draftId) {
        await streamPlanClarify(draftId, fields, handlers, ac.signal);
      } else {
        await streamPlanGenerate(fields, handlers, ac.signal);
      }
      if (summary && !ac.signal.aborted) await typewrite(summary, ac.signal);
    } catch (err) {
      if (ac.signal.aborted) {
        pushAssistant('规划生成已中断，已保留上方已显示内容。');
      } else {
        pushAssistant(
          err instanceof ApiError
            ? `规划请求失败：${err.message}`
            : '规划请求失败，请稍后重试',
        );
      }
    } finally {
      stopStreaming();
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="scheme-light space-y-2 border-b border-brandFaint bg-brandFaint/40 px-3 py-3 text-brandDark"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-brandDark">
          {draftId ? '补充学习目标（追问中）' : '提交学习目标'}
        </p>
        {onDismiss ? (
          <button
            type="button"
            aria-label="收起目标表单"
            title="收起目标表单（聊天继续）"
            onClick={onDismiss}
            className="rounded-full p-0.5 text-brandDark/70 transition hover:bg-white/80 hover:text-brandDark"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {clarifyQuestion ? (
        <p className="rounded-lg bg-white/80 px-2 py-1.5 text-[11px] text-brandDark">
          {clarifyQuestion}
        </p>
      ) : null}
      <input
        type="text"
        value={goalName}
          onChange={(e) => setGoalName(e.target.value)}
        placeholder="要学的内容，如：线性代数证明入门"
        className="w-full rounded-lg border border-brandFaint bg-white px-2.5 py-1.5 text-xs text-brandDark outline-none placeholder:text-gray-400 focus:border-brand"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          value={goalDate}
          onChange={(e) => setGoalDate(e.target.value)}
          className="rounded-lg border border-brandFaint bg-white px-2.5 py-1.5 text-xs text-brandDark outline-none focus:border-brand"
          aria-label="目标期限"
        />
        <input
          type="number"
          min={1}
          value={dailyMinutes}
          onChange={(e) => setDailyMinutes(e.target.value)}
          placeholder="每日分钟"
          className="rounded-lg border border-brandFaint bg-white px-2.5 py-1.5 text-xs text-brandDark outline-none placeholder:text-gray-400 focus:border-brand"
          aria-label="每日学习分钟"
        />
      </div>
      <input
        type="text"
        value={currentLevel}
        onChange={(e) => setCurrentLevel(e.target.value)}
        placeholder="当前基础，如：学过矩阵运算"
        className="w-full rounded-lg border border-brandFaint bg-white px-2.5 py-1.5 text-xs text-brandDark outline-none placeholder:text-gray-400 focus:border-brand"
      />
      <input
        type="text"
        value={completionCriterion}
        onChange={(e) => setCompletionCriterion(e.target.value)}
        placeholder="完成标准，如：能独立证明秩不等式"
        className="w-full rounded-lg border border-brandFaint bg-white px-2.5 py-1.5 text-xs text-brandDark outline-none placeholder:text-gray-400 focus:border-brand"
        aria-label="完成标准"
      />
      <div>
        <p className="mb-1 text-[11px] text-gray-500">规划依据资料（可多选）</p>
        <DocumentPicker />
      </div>
      {hint ? <p className="text-[11px] text-dangerText">{hint}</p> : null}
      <button
        type="submit"
        disabled={streaming}
        className="w-full rounded-full bg-brandDark py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {streaming ? '规划生成中…' : draftId ? '提交补充并继续' : '生成学习规划'}
      </button>
    </form>
  );
}

export default GoalSubmitForm;
