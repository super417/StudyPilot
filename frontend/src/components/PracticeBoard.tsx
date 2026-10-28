import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PracticeGradingControls, { type GradingMode } from './PracticeGradingControls';
import { completePracticeQuestion, pendingPracticeIds, validBatchSize } from '@/lib/practiceAutoQueue';
import CameraCapture from '@/components/CameraCapture';
import './ExerciseCapsule.css';
import { ApiError } from '@/lib/httpClient';
import { recognizeQuestionImage } from '@/lib/mistakesApi';
import {
  createPractice,
  deletePractice,
  explainPractice,
  generatePractice,
  listPractice,
  setPracticeStatus,
  type ExplanationReview,
  type PracticeQuestion,
  type PracticeSourceRef,
} from '@/lib/practiceApi';
import { practiceDayISO } from '@/lib/dates';
import { gradePracticeBatch } from '@/lib/practiceBatch';

export interface PracticeBoardProps {
  controlsTarget?: HTMLElement | null;
  tab: 'today' | 'review';
  onWrong: () => void;
}

/** True only when the card should render a source block (never show empty兜底). */
export function hasVisibleSourceRefs(
  refs: PracticeSourceRef[] | null | undefined,
): boolean {
  return Array.isArray(refs) && refs.length > 0;
}

export function sourceRefSummary(ref: PracticeSourceRef): string {
  return `出自《${ref.filename}》第 ${ref.chunkIndex + 1} 段`;
}

export function mergeGeneratedQuestions(
  current: PracticeQuestion[],
  generated: PracticeQuestion[],
): PracticeQuestion[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...generated.filter((item) => !seen.has(item.id))];
}

function ReviewList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-brandDark">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-600">
        {items.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function PracticeCard({
  item,
  onChanged,
  onWrong,
  answerText,
  onAnswer,
  gradeNote,
  onGrade,
  locked,
  onBusy,
  selecting,
  selected,
  onSelect,
  onComplete,
  completed,
  completionDisabled,
}: {
  item: PracticeQuestion;
  onChanged: () => void;
  onWrong: () => void;
  answerText: string;
  onAnswer: (value: string) => void;
  gradeNote?: string;
  onGrade: () => void;
  locked: boolean;
  onBusy: (value: boolean) => void;
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
  onComplete?: () => void;
  completed: boolean;
  completionDisabled: boolean;
}) {
  const [showAnswer, setShowAnswer] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainText, setExplainText] = useState('');
  const [explainNote, setExplainNote] = useState<string | null>(null);
  const [explainReview, setExplainReview] = useState<ExplanationReview | null>(null);
  const [explainCounted, setExplainCounted] = useState(false);

  const explain = async () => {
    if (busy || locked) return;
    if (!explainText.trim()) {
      setExplainNote('请先写下你的口述');
      setExplainReview(null);
      setExplainCounted(false);
      return;
    }
    setBusy(true);
    onBusy(true);
    setExplainNote(null);
    setExplainReview(null);
    setExplainCounted(false);
    try {
      const body = await explainPractice(item.id, explainText.trim());
      if (body.result === 'insufficient') {
        setExplainNote(body.reason ?? '依据不足：没有可对照的原文');
        return;
      }
      const verdict =
        body.result === 'correct' ? '讲得对' : body.result === 'partial' ? '部分讲对' : '讲错了';
      setExplainNote(`${verdict}。${body.reason ?? ''}`);
      setExplainReview(body.explanationReview ?? { covered: [], missing: [], wrong: [] });
      setExplainCounted(true);
      onChanged();
    } catch (err) {
      setExplainNote(err instanceof ApiError ? err.message : '口述评分失败，没有写入掌握度证据');
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };

  const mark = async (status: 'wrong') => {
    if (busy || locked) return;
    setBusy(true);
    onBusy(true);
    setNote(null);
    try {
      await setPracticeStatus(item.id, status);
      if (status === 'wrong') {
        setNote('已加入错题本复习队列');
        onWrong();
      }
      onChanged();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : '标记失败');
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };

  const showSources = hasVisibleSourceRefs(item.sourceRefs);

  return (
    <article className="pressable-card rounded-3xl bg-card p-4 text-brandDark">
      {selecting ? <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={selected} disabled={locked} onChange={onSelect} />选择此题</label> : null}
      <fieldset disabled={locked || busy} className="min-w-0">
        <p className="text-xs text-gray-500">{item.subject || '综合'} · {item.source === 'uploaded' ? '自己上传' : '今日生成'}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{item.question}</p>
        {showAnswer ? (
          <>
            <div className="mt-3 rounded-2xl bg-brandFaint px-3 py-2 text-sm">
              <p>答案：{item.answer || '（无）'}</p>
              {item.explanation ? (
                <p className="mt-1 text-gray-600">解析：{item.explanation}</p>
              ) : null}
            </div>
            {showSources ? (
              <ul className="mt-2 space-y-1 text-xs text-slate-500">
                {item.sourceRefs!.map((ref) => (
                  <li key={`${ref.docId}-${ref.chunkIndex}`}>
                    <details>
                      <summary className="cursor-pointer text-slate-600 underline decoration-slate-400 underline-offset-2">
                        {sourceRefSummary(ref)}
                      </summary>
                      <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-600">
                        {ref.snippet}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
        <label className="mt-3 block text-xs text-gray-500">
          我的作答
          <textarea
            value={answerText}
            onChange={(event) => onAnswer(event.target.value)}
            rows={3}
            className="mt-1 w-full rounded-2xl bg-white px-3 py-2 text-sm text-brandDark ring-1 ring-brand/20"
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="rounded-full bg-white px-3 py-1 text-xs ring-1 ring-brand/30" onClick={() => setShowAnswer((v) => !v)}>
            {showAnswer ? '隐藏答案' : '显示答案'}
          </button>
          {onComplete ? (
            <button type="button" disabled={completionDisabled || completed || (!!item.latestGrade && answerText.trim() === item.latestGrade.answerText.trim())} onClick={() => {
              if (!answerText.trim()) { setNote('请先写下你的作答'); return; }
              setNote(null);
              onComplete();
            }} className="rounded-full bg-brand px-3 py-1 text-xs text-white disabled:opacity-60">
              {completed ? '已完成，等待判分' : '完成本题'}
            </button>
          ) : null}
          {!onComplete ? (
          <button type="button" disabled={busy || (!!item.latestGrade && answerText.trim() === item.latestGrade.answerText.trim())} className="rounded-full bg-brand px-3 py-1 text-xs text-white disabled:opacity-60" onClick={() => { if (!answerText.trim()) { setNote('请先写下你的作答'); return; } setNote(null); onGrade(); }}>
            {item.latestGrade ? '重新判分' : '提交判分'}
          </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            className="rounded-full bg-white px-3 py-1 text-xs text-brandDark ring-1 ring-brand/30 disabled:opacity-60"
            onClick={() => {
              setExplainOpen((v) => !v);
              setExplainNote(null);
              setExplainReview(null);
              setExplainCounted(false);
            }}
          >
            讲给 AI 听
          </button>
          <button type="button" disabled={busy} className="rounded-full bg-brandDark px-3 py-1 text-xs text-white disabled:opacity-60" onClick={() => void mark('wrong')}>
            做错了
          </button>
          <button
            type="button"
            className="rounded-full px-3 py-1 text-xs text-dangerText"
            onClick={() => { onBusy(true); void deletePractice(item.id).then(onChanged).catch(() => setNote('删除失败')).finally(() => onBusy(false)); }}
          >
            删除
          </button>
        </div>
        {gradeNote ? <p className="mt-2 text-xs text-brandDark" role="status">{gradeNote}</p> : null}
        {note ? <p className="mt-2 text-xs text-brandDark">{note}</p> : null}
        {explainOpen ? (
          <div className="mt-3 rounded-2xl bg-brandFaint/60 px-3 py-3">
            <label className="block text-xs text-gray-500">
              用文字讲一遍（不做语音）
              <textarea
                value={explainText}
                onChange={(event) => setExplainText(event.target.value)}
                rows={4}
                className="mt-1 w-full rounded-2xl bg-white px-3 py-2 text-sm text-brandDark ring-1 ring-brand/20"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              className="mt-2 rounded-full bg-brand px-3 py-1 text-xs text-white disabled:opacity-60"
              onClick={() => void explain()}
            >
              提交口述
            </button>
            {explainNote ? <p className="mt-2 text-xs text-brandDark">{explainNote}</p> : null}
            {explainReview ? (
              <div className="mt-1">
                <ReviewList title="讲对了什么" items={explainReview.covered} />
                <ReviewList title="漏了什么" items={explainReview.missing} />
                <ReviewList title="错在哪" items={explainReview.wrong} />
              </div>
            ) : null}
            {explainCounted ? (
              <p className="mt-2 text-xs text-slate-600">已计入掌握度证据</p>
            ) : null}
          </div>
        ) : null}
      </fieldset>
    </article>
  );
}

function PracticeBoard({ tab, onWrong, controlsTarget }: PracticeBoardProps) {
  // 必须与后端 list_practice 的 UTC 日分桶对齐，不能用本地 todayISO()
  const practiceDay = practiceDayISO();
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [review, setReview] = useState<PracticeQuestion[]>([]);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<GradingMode>('all');
  const [batchSize, setBatchSize] = useState('5');
  const [queued, setQueued] = useState<string[]>([]);
  const queueRef = useRef<string[]>([]);
  const updateQueue = (ids: string[]) => {
    queueRef.current = ids;
    setQueued(ids);
  };
  const size = validBatchSize(batchSize);
  const selecting = mode === 'selected';

  useEffect(() => {
    if (tab !== 'today') {
      queueRef.current = [];
      setQueued([]);
    }
  }, [tab]);
  const [selected, setSelected] = useState<string[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [grading, setGrading] = useState(false);
  const operation = useRef(false);
  const [cardBusy, setCardBusy] = useState(false);
  const lockCard = (value: boolean) => {
    operation.current = value;
    setCardBusy(value);
  };
  const locked = busy || grading || cardBusy;

  const reload = useCallback(async () => {
    const res = await listPractice(practiceDay);
    setQuestions(res.questions);
    setReview(res.review);
  }, [practiceDay]);

  useEffect(() => {
    void reload().catch((err) => {
      setMessage(err instanceof ApiError ? err.message : '练习题加载失败');
    });
  }, [reload]);

  const generate = async () => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const res = await generatePractice(practiceDay);
      setMessage(res.questions.length ? `已生成 ${res.questions.length} 题` : '今天还没有完成的任务，先去勾选今天的任务');
      // 先追加新题，保留旧卡片的 id 与作答/判分状态；reload 再与服务端同步。
      if (res.questions.length) {
        setQuestions((current) => mergeGeneratedQuestions(current, res.questions));
      }
      await reload();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : '生成失败');
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };

  const uploadText = async (text: string) => {
    const question = text.trim();
    if (!question || operation.current) return;
    operation.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await createPractice({ question });
      setDraft('');
      setMessage('已加入习题');
      await reload();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : '上传失败');
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };

  const gradeQuestions = async (ids: string[]) => {
    if (operation.current || busy || cameraOpen) return;
    operation.current = true;
    updateQueue(queueRef.current.filter((id) => !ids.includes(id)));
    setGrading(true);
    const source = [...questions, ...review];
    try {
      const summary = await gradePracticeBatch(source, ids, answers, {
        progress: (done, total) => setMessage(`正在判分：${done} / ${total}`),
        success: (item, answer, body) => {
          const latestGrade = { answerText: answer, result: body.result, reason: body.reason };
          const update = (rows: PracticeQuestion[]) => rows.map((row) => (
            row.id === item.id ? { ...row, latestGrade } : row
          ));
          setQuestions(update);
          setReview(update);
          const verdict = body.result === 'correct' ? '答对' : body.result === 'partial' ? '部分正确' : '答错';
          setNotes((prev) => ({ ...prev, [item.id]: `${verdict}。${body.reason ?? ''}` }));
        },
        failure: (item, err) => setNotes((prev) => ({
          ...prev,
          [item.id]: err instanceof ApiError ? err.message : '判分失败，请重试',
        })),
      });
      setFailed((previous) => [...previous.filter((id) => !ids.includes(id)), ...summary.failed]);
      setMessage(`判分完成 ${summary.total} / ${summary.total}：成功 ${summary.success} 题，失败 ${summary.failed.length} 题；跳过未作答 ${summary.blank} 题、已判分且未修改 ${summary.unchanged} 题。`);
    } finally {
      operation.current = false;
      setGrading(false);
    }
  };

  const complete = (id: string) => {
    if (tab !== 'today' || mode !== 'auto' || !size || operation.current || cameraOpen) return;
    const next = completePracticeQuestion(queueRef.current, id, size, questions, answers);
    updateQueue(next.queue);
    if (next.batch.length) void gradeQuestions(next.batch);
  };

  const rows = tab === 'today' ? questions : review;
  const selectedIds = selected.filter((id) => questions.some((item) => item.id === id));
  const failedIds = failed.filter((id) => questions.some((item) => item.id === id));

  const pendingIds = pendingPracticeIds(queued, questions, answers);
  const controls = tab === 'today' ? (
    <PracticeGradingControls
      mode={mode}
      onMode={(next) => {
        if (operation.current) return;
        setMode(next);
        setSelected([]);
        updateQueue([]);
      }}
      disabled={locked || cameraOpen}
      size={batchSize}
      onSize={(value) => { setBatchSize(value); updateQueue([]); }}
      validSize={size !== null}
      pending={pendingIds.length}
      selected={selectedIds.length}
      failed={failedIds.length}
      total={questions.length}
      onGrade={() => void gradeQuestions(mode === 'selected' ? selectedIds : questions.map((item) => item.id))}
      onFinish={() => { if (size) void gradeQuestions(pendingIds); }}
      onRetry={() => void gradeQuestions(failedIds)}
    />
  ) : null;

  return (
    <section className="space-y-4">
      {controlsTarget ? createPortal(controls, controlsTarget) : controls}
      <fieldset disabled={locked} className="min-w-0 space-y-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void generate()} className="exercise-capsule rounded-full bg-brandDark px-4 py-2 text-sm text-white disabled:opacity-60">
          {busy ? '处理中…' : '生成今日练习'}
        </button>
        <button type="button" onClick={() => setCameraOpen(true)} className="exercise-capsule rounded-full bg-white px-4 py-2 text-sm text-brandDark ring-1 ring-brand/30">
          拍照识题
        </button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void uploadText(draft);
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="贴一道题，加入习题"
          className="min-w-0 flex-1 rounded-full border border-brandFaint bg-white px-4 py-2 text-sm text-brandDark outline-none"
        />
        <button type="submit" className="rounded-full bg-brand px-4 py-2 text-sm text-white">
          上传
        </button>
      </form>
      </fieldset>
      {message ? <p role="status" aria-live="polite" className="text-sm text-brandDark">{message}</p> : null}
      {rows.length === 0 ? <p className="text-sm text-gray-500">{tab === 'today' ? '今天还没有练习题' : '没有待复习的练习题'}</p> : null}
      {rows.map((item) => (
        <PracticeCard
          key={item.id}
          item={item}
          onChanged={() => void reload().catch(() => setMessage('同步失败，请刷新重试'))}
          onWrong={onWrong}
          answerText={answers[item.id] ?? item.latestGrade?.answerText ?? ''}
          onAnswer={(value) => {
            setAnswers((prev) => ({ ...prev, [item.id]: value }));
            updateQueue(queueRef.current.filter((id) => id !== item.id));
          }}
          gradeNote={notes[item.id] ?? (item.latestGrade ? `已判分：${item.latestGrade.result === 'correct' ? '答对' : item.latestGrade.result === 'partial' ? '部分正确' : '答错'}。${item.latestGrade.reason ?? ''}` : undefined)}
          onGrade={() => void gradeQuestions([item.id])}
          locked={locked || cameraOpen}
          onBusy={lockCard}
          onComplete={tab === 'today' && mode === 'auto' ? () => complete(item.id) : undefined}
          completed={pendingIds.includes(item.id)}
          completionDisabled={!size}
          selecting={tab === 'today' && selecting}
          selected={selected.includes(item.id)}
          onSelect={() => setSelected((prev) => prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id])}
        />
      ))}
      {cameraOpen ? (
        <CameraCapture
          open={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onCapture={(file) => {
            setCameraOpen(false);
            void recognizeQuestionImage(file)
              .then((res) => uploadText(res.text))
              .catch((err) => setMessage(err instanceof ApiError ? err.message : '识别失败'));
          }}
        />
      ) : null}
    </section>
  );
}

export default PracticeBoard;
