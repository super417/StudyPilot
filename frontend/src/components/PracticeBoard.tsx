import { useCallback, useEffect, useState } from 'react';
import CameraCapture from '@/components/CameraCapture';
import { ApiError } from '@/lib/httpClient';
import { recognizeQuestionImage } from '@/lib/mistakesApi';
import {
  createPractice,
  deletePractice,
  explainPractice,
  generatePractice,
  gradePractice,
  listPractice,
  setPracticeStatus,
  type ExplanationReview,
  type PracticeQuestion,
  type PracticeSourceRef,
} from '@/lib/practiceApi';
import { practiceDayISO } from '@/lib/dates';

export interface PracticeBoardProps {
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
}: {
  item: PracticeQuestion;
  onChanged: () => void;
  onWrong: () => void;
}) {
  const [showAnswer, setShowAnswer] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainText, setExplainText] = useState('');
  const [explainNote, setExplainNote] = useState<string | null>(null);
  const [explainReview, setExplainReview] = useState<ExplanationReview | null>(null);
  const [explainCounted, setExplainCounted] = useState(false);

  const grade = async () => {
    if (busy) return;
    if (!answerText.trim()) {
      setNote('请先写下你的作答');
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const body = await gradePractice(item.id, answerText.trim());
      const verdict = body.result === 'correct' ? '答对' : body.result === 'partial' ? '部分正确' : '答错';
      setNote(`${verdict}。${body.reason ?? ''}`);
      onChanged();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : '判分失败，没有写入掌握度证据');
    } finally {
      setBusy(false);
    }
  };

  const explain = async () => {
    if (busy) return;
    if (!explainText.trim()) {
      setExplainNote('请先写下你的口述');
      setExplainReview(null);
      setExplainCounted(false);
      return;
    }
    setBusy(true);
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
    }
  };

  const mark = async (status: 'wrong') => {
    if (busy) return;
    setBusy(true);
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
    }
  };

  const showSources = hasVisibleSourceRefs(item.sourceRefs);

  return (
    <article className="rounded-3xl bg-card p-4 text-brandDark">
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
          onChange={(event) => setAnswerText(event.target.value)}
          rows={3}
          className="mt-1 w-full rounded-2xl bg-white px-3 py-2 text-sm text-brandDark ring-1 ring-brand/20"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="rounded-full bg-white px-3 py-1 text-xs ring-1 ring-brand/30" onClick={() => setShowAnswer((v) => !v)}>
          {showAnswer ? '隐藏答案' : '显示答案'}
        </button>
        <button type="button" disabled={busy} className="rounded-full bg-brand px-3 py-1 text-xs text-white disabled:opacity-60" onClick={() => void grade()}>
          提交判分
        </button>
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
          onClick={() => void deletePractice(item.id).then(onChanged).catch(() => setNote('删除失败'))}
        >
          删除
        </button>
      </div>
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
    </article>
  );
}

function PracticeBoard({ tab, onWrong }: PracticeBoardProps) {
  // 必须与后端 list_practice 的 UTC 日分桶对齐，不能用本地 todayISO()
  const practiceDay = practiceDayISO();
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [review, setReview] = useState<PracticeQuestion[]>([]);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

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
    setBusy(true);
    setMessage(null);
    try {
      const res = await generatePractice(practiceDay);
      setMessage(res.questions.length ? `已生成 ${res.questions.length} 题` : '今天还没有完成的任务，先去勾选今天的任务');
      // 立刻用生成结果填列表，避免仅依赖 reload 时出现空窗
      if (res.questions.length) {
        setQuestions(res.questions);
      }
      await reload();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : '生成失败');
    } finally {
      setBusy(false);
    }
  };

  const uploadText = async (text: string) => {
    const question = text.trim();
    if (!question) return;
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
      setBusy(false);
    }
  };

  const rows = tab === 'today' ? questions : review;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void generate()} className="rounded-full bg-brandDark px-4 py-2 text-sm text-white disabled:opacity-60">
          {busy ? '处理中…' : '生成今日练习'}
        </button>
        <button type="button" onClick={() => setCameraOpen(true)} className="rounded-full bg-white px-4 py-2 text-sm text-brandDark ring-1 ring-brand/30">
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
      {message ? <p className="text-sm text-brandDark">{message}</p> : null}
      {rows.length === 0 ? <p className="text-sm text-gray-500">{tab === 'today' ? '今天还没有练习题' : '没有待复习的练习题'}</p> : null}
      {rows.map((item) => (
        <PracticeCard key={item.id} item={item} onChanged={() => void reload()} onWrong={onWrong} />
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
