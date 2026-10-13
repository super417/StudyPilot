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
import { resolvePlanTargetId } from '@/lib/planTarget';
import type { MaterialComparisonResponse, MaterialTaskPreviewResponse } from '@/lib/materialsApi';

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
  const activePlanId = usePlanSessionStore((s) => s.activePlanId);
  const lastPlanId = usePlanSessionStore((s) => s.lastPlanId);
  const selectedDocumentIds = useDocumentsStore((s) => s.selectedIds);

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
  const [materialLink, setMaterialLink] = useState('');
  const [materialComparison, setMaterialComparison] = useState<MaterialComparisonResponse | null>(null);
  const [materialHint, setMaterialHint] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const materialOp = useRef(0);
  const planSeen = useRef<string | null | undefined>(undefined);
  const selectableComparisonId = useRef<string | null>(null);
  const previewOp = useRef(0);
  const [materialFlow, setMaterialFlow] = useState(false);
  const [materialBusy, setMaterialBusy] = useState(false);
  const [materialPreview, setMaterialPreview] = useState<MaterialTaskPreviewResponse | null>(null);
  const liveSelection = useRef<{ comparisonId: string | null; candidateId: string | null }>({
    comparisonId: null,
    candidateId: null,
  });
  const selectionPending = useRef(false);
  const currentPlanId = resolvePlanTargetId(activePlanId, lastPlanId);
  if (planSeen.current !== undefined && planSeen.current !== currentPlanId) {
    materialOp.current += 1;
    previewOp.current += 1;
    setMaterialPreview(null);
    if (materialComparison && (materialComparison.planId ?? null) !== currentPlanId) {
      selectableComparisonId.current = null;
      setMaterialComparison(null);
    }
  }
  planSeen.current = currentPlanId;

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

  const forgetComparison = () => {
    materialOp.current += 1;
    previewOp.current += 1;
    selectableComparisonId.current = null;
    setMaterialComparison(null);
    setMaterialPreview(null);
  };

  const shownComparison =
    materialComparison && (materialComparison.planId ?? null) === currentPlanId
      ? materialComparison
      : null;
  selectableComparisonId.current = shownComparison?.comparisonId ?? null;
  liveSelection.current = selectionPending.current
    ? { comparisonId: shownComparison?.comparisonId ?? null, candidateId: null }
    : {
        comparisonId: shownComparison?.comparisonId ?? null,
        candidateId: shownComparison?.selectedCandidateId ?? null,
      };

  const handleCompare = async () => {
    const ticket = ++materialOp.current;
    const planId = currentPlanId;
    selectableComparisonId.current = null;
    setMaterialComparison(null);
    previewOp.current += 1;
    setMaterialPreview(null);
    setMaterialFlow(true);
    setMaterialBusy(true);
    clearClarify();
    usePlanSessionStore.getState().blockLegacyDraft?.();
    try {
    let minutes = Number(dailyMinutes);
    if (!planId) {
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
        setMaterialHint(checked.hint);
        return;
      }
      minutes = checked.value.dailyMinutes;
    }
    setMaterialHint(null);
    const link = materialLink.trim();
    const { compareMaterials } = await import('@/lib/materialsApi');
    try {
      const result = await compareMaterials({
        goalName: goalName.trim(),
        goalDate: goalDate.trim(),
        currentLevel: currentLevel.trim(),
        dailyMinutes: minutes,
        completionCriterion: completionCriterion.trim(),
        planId,
        documentIds: selectedDocumentIds ?? [],
        links: link ? [link] : [],
      });
      if (ticket !== materialOp.current || planSeen.current !== planId) return;
      setMaterialComparison(result);
    } catch (err) {
      if (ticket !== materialOp.current || planSeen.current !== planId) return;
      setMaterialComparison(null);
      setMaterialHint(err instanceof ApiError ? err.message : '比较失败');
    }
    } finally {
      if (ticket === materialOp.current) setMaterialBusy(false);
    }
  };

  const handleSelectMaterial = async (candidateId: string) => {
    if (!shownComparison) return;
    const comparisonId = shownComparison.comparisonId;
    if (selectableComparisonId.current !== comparisonId) return;
    const ticket = ++materialOp.current;
    const planId = currentPlanId;
    selectionPending.current = true;
    setMaterialBusy(true);
    previewOp.current += 1;
    setMaterialPreview(null);
    liveSelection.current = { comparisonId, candidateId: null };
    const { selectMaterial } = await import('@/lib/materialsApi');
    try {
      const result = await selectMaterial(comparisonId, {
        candidateId,
        goalName: goalName.trim(),
        goalDate: goalDate.trim(),
        currentLevel: currentLevel.trim(),
        dailyMinutes: Number(dailyMinutes),
        completionCriterion: completionCriterion.trim(),
      });
      if (ticket !== materialOp.current || planSeen.current !== planId) return;
      setMaterialComparison(result);
      setMaterialPreview(null);
      previewOp.current += 1;
    } catch (err) {
      if (ticket !== materialOp.current || planSeen.current !== planId) return;
      setMaterialComparison(null);
      setMaterialPreview(null);
      previewOp.current += 1;
      setMaterialHint(err instanceof ApiError ? err.message : '这次选择已失效，请重新比较');
    } finally {
      if (ticket === materialOp.current) {
        selectionPending.current = false;
        setMaterialBusy(false);
      }
    }
  };

  const handleMaterialPreview = async () => {
    if (materialBusy || selectionPending.current) {
      setMaterialHint(selectionPending.current ? '正在选择资料，还不能生成任务' : '正在比较，还不能生成任务');
      return;
    }
    const selected = shownComparison?.candidates.find(
      (item) => item.candidateId === shownComparison.selectedCandidateId,
    );
    if (!shownComparison || !selected || selected.usableSource === false || selected.readStatus !== 'read') {
      setMaterialHint('请选择一份有正文的资料，或重新比较');
      return;
    }
    const ticket = ++previewOp.current;
    const planId = currentPlanId;
    const comparisonId = shownComparison.comparisonId;
    const selectedId = shownComparison.selectedCandidateId;
    setMaterialPreview(null);
    setMaterialHint(null);
    try {
      const { previewMaterialTasks } = await import('@/lib/materialsApi');
      const result = await previewMaterialTasks(comparisonId, {
        goalName: goalName.trim(),
        goalDate: goalDate.trim(),
        currentLevel: currentLevel.trim(),
        dailyMinutes: Number(dailyMinutes),
        completionCriterion: completionCriterion.trim(),
        planId,
      });
      if (ticket !== previewOp.current || planSeen.current !== planId) return;
      if (liveSelection.current.comparisonId !== comparisonId) return;
      if (liveSelection.current.candidateId !== selectedId) return;
      setMaterialPreview(result);
    } catch (err) {
      if (ticket !== previewOp.current || planSeen.current !== planId) return;
      setMaterialPreview(null);
      setMaterialHint(err instanceof ApiError ? err.message : '预览没有生成');
    }
  };

  const handleSubmit = async (e: FormEvent, legacy = false) => {
    e.preventDefault();
    if (streaming) return;
    if (materialFlow && !legacy) {
      await handleMaterialPreview();
      return;
    }

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
        setPreview(data.draftId, data.summary);
        pushAssistant(data.summary);
      },
      onDone: (data: { planId: string; phases: number; usedDocs: string[] }) => {
        clearClarify();
        setLastPlanId(data.planId);
        setActivePlanId(data.planId);
        usePlanSessionStore.getState().askForStart(data.planId);
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
          onChange={(e) => {
            setGoalName(e.target.value);
            forgetComparison();
          }}
        placeholder="要学的内容，如：线性代数证明入门"
        className="w-full rounded-lg border border-brandFaint bg-white px-2.5 py-1.5 text-xs text-brandDark outline-none placeholder:text-gray-400 focus:border-brand"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          value={goalDate}
          onChange={(e) => {
            setGoalDate(e.target.value);
            forgetComparison();
          }}
          className="rounded-lg border border-brandFaint bg-white px-2.5 py-1.5 text-xs text-brandDark outline-none focus:border-brand"
          aria-label="目标期限"
        />
        <input
          type="number"
          min={1}
          value={dailyMinutes}
          onChange={(e) => {
            setDailyMinutes(e.target.value);
            forgetComparison();
          }}
          placeholder="每日分钟"
          className="rounded-lg border border-brandFaint bg-white px-2.5 py-1.5 text-xs text-brandDark outline-none placeholder:text-gray-400 focus:border-brand"
          aria-label="每日学习分钟"
        />
      </div>
      <input
        type="text"
        value={currentLevel}
        onChange={(e) => {
          setCurrentLevel(e.target.value);
          forgetComparison();
        }}
        placeholder="当前基础，如：学过矩阵运算"
        className="w-full rounded-lg border border-brandFaint bg-white px-2.5 py-1.5 text-xs text-brandDark outline-none placeholder:text-gray-400 focus:border-brand"
      />
      <input
        type="text"
        value={completionCriterion}
        onChange={(e) => {
          setCompletionCriterion(e.target.value);
          forgetComparison();
        }}
        placeholder="完成标准，如：能独立证明秩不等式"
        className="w-full rounded-lg border border-brandFaint bg-white px-2.5 py-1.5 text-xs text-brandDark outline-none placeholder:text-gray-400 focus:border-brand"
        aria-label="完成标准"
      />
      <div>
        <p className="mb-1 text-[11px] text-gray-500">规划依据资料（可多选）</p>
        <DocumentPicker />
      </div>
      {hint ? <p className="text-[11px] text-dangerText">{hint}</p> : null}
      <input
        type="url"
        value={materialLink}
        onChange={(e) => setMaterialLink(e.target.value)}
        placeholder="要比较的链接，可与已选文档一起比较"
        aria-label="比较链接"
        className="w-full rounded-lg border border-brandFaint bg-white px-2.5 py-1.5 text-xs text-brandDark outline-none placeholder:text-gray-400 focus:border-brand"
      />
      <button
        type="button"
        onClick={() => handleCompare()}
        className="w-full rounded-full border border-brandDark py-1.5 text-xs font-medium text-brandDark"
      >
        比较资料
      </button>
      {materialHint ? <p className="text-[11px] text-dangerText">{materialHint}</p> : null}
      {shownComparison ? (
        <div className="space-y-2 rounded-lg bg-white/80 p-2 text-[11px]">
          <p>
            这次比较使用的目标：{shownComparison.goal.goalName}，期限 {shownComparison.goal.goalDate}，基础 {shownComparison.goal.currentLevel}，每日 {shownComparison.goal.dailyMinutes} 分钟，完成标准 {shownComparison.goal.completionCriterionLabel}。
            {shownComparison.planId ? `这是规划 ${shownComparison.planId} 上的目标。` : '这是尚未提交的学习目标。'}
            刷新后需要重新比较。
          </p>
          <p>
            {shownComparison.suggestion.status === 'suggested'
              ? `建议：${shownComparison.suggestion.text}`
              : shownComparison.suggestion.status === 'failed'
                ? '模型建议没有生成。'
                : '没有调用模型，下面只显示读到的事实。'}
          </p>
          {shownComparison.candidates.map((item) => (
            <div key={item.candidateId} className="rounded border border-brandFaint p-2">
              <p>
                {item.displayName}（{item.readStatus === 'read' ? '已读取' : item.readStatus === 'title_only' ? '仅标题' : '失败'}）
              </p>
              <p>来源：{item.source.url ?? item.source.docId}</p>
              <p>先修：{item.facts.prerequisite}</p>
              <p>覆盖：{item.facts.coverage}</p>
              {item.facts.excerpts.map((excerpt) => (
                <p key={`${item.candidateId}-${excerpt.chunkIndex}`}>
                  片段 {excerpt.chunkIndex}
                  {excerpt.pageStart != null ? `，第 ${excerpt.pageStart} 页` : ''}
                </p>
              ))}
              <p>
                时长：{item.facts.duration.status}
                {item.facts.duration.playSeconds != null ? `，${item.facts.duration.playSeconds} 秒` : ''}
                。{item.facts.duration.note}
              </p>
              {item.facts.unreadNote ? <p>{item.facts.unreadNote}</p> : null}
              {item.facts.basisNote ? <p>{item.facts.basisNote}</p> : null}
              {item.readStatus === 'failed' ? null : (
                <button
                  type="button"
                  onClick={() => handleSelectMaterial(item.candidateId)}
                  className="mt-1 rounded-full bg-brandDark px-2 py-1 text-white"
                >
                  {shownComparison.selectedCandidateId === item.candidateId ? '已选择这份' : '选择这份'}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {materialPreview ? (
        <div className="space-y-1 rounded-lg bg-white/80 p-2 text-[11px]">
          <p>{materialPreview.confirmOpen ? '可以确认写入' : '还不能确认写入'}</p>
          <p>
            资料范围：
            {materialPreview.basis.kind === 'document'
              ? `${materialPreview.basis.docId}，片段 ${materialPreview.basis.chunks?.map((chunk) => chunk.chunkIndex).join('、') || '无'}`
              : materialPreview.basis.url}
            。名称只用于显示：{materialPreview.displayName}
          </p>
          {materialPreview.phases.map((phase) => (
            <div key={`${phase.name}-${phase.startDate}`}>
              {phase.tasks.map((task) => (
                <p key={task.actionId}>
                  {task.description}
                  {task.estimatedMinutes == null ? '，预计未知' : `，预计 ${task.estimatedMinutes} 分钟`}
                </p>
              ))}
            </div>
          ))}
          {materialPreview.emptyDates.length > 0 ? (
            <p>这些日期没有安排，不会补任务：{materialPreview.emptyDates.join('、')}</p>
          ) : null}
          <p>{materialPreview.validation.ok ? '规则通过，这一步仍不能确认。' : '规则未通过，不能确认。'}</p>
        </div>
      ) : null}
      <button
        type="submit"
        disabled={streaming || materialBusy || selectionPending.current}
        className="w-full rounded-full bg-brandDark py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {streaming
          ? '规划生成中…'
          : materialFlow
            ? materialBusy
              ? '正在比较'
              : '生成资料任务预览'
            : draftId
              ? '提交补充并继续'
              : '生成学习规划'}
      </button>
      {materialFlow ? (
        <button
          type="button"
          onClick={(event) => {
            usePlanSessionStore.getState().releaseLegacyDraft?.();
            setMaterialFlow(false);
            void handleSubmit(event, true);
          }}
          className="w-full rounded-full border border-brandDark py-1.5 text-xs font-medium text-brandDark"
        >
          不使用这次资料比较，按原来的方式生成
        </button>
      ) : null}
    </form>
  );
}

export default GoalSubmitForm;
