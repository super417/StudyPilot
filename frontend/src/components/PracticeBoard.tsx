import { useCallback, useEffect, useState } from 'react';
import CameraCapture from '@/components/CameraCapture';
import { ApiError } from '@/lib/httpClient';
import { recognizeQuestionImage } from '@/lib/mistakesApi';
import {
  createPractice,
  deletePractice,
  generatePractice,
  listPractice,
  setPracticeStatus,
  type PracticeQuestion,
} from '@/lib/practiceApi';
import { todayISO } from '@/lib/dates';

export interface PracticeBoardProps {
  tab: 'today' | 'review';
  onWrong: () => void;
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
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mark = async (status: 'correct' | 'wrong') => {
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

  return (
    <article className="rounded-3xl bg-card p-4 text-brandDark">
      <p className="text-xs text-gray-500">{item.subject || '综合'} · {item.source === 'uploaded' ? '自己上传' : '今日生成'}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{item.question}</p>
      {showAnswer ? (
        <div className="mt-3 rounded-2xl bg-brandFaint px-3 py-2 text-sm">
          <p>答案：{item.answer || '（无）'}</p>
          {item.explanation ? <p className="mt-1 text-gray-600">解析：{item.explanation}</p> : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="rounded-full bg-white px-3 py-1 text-xs ring-1 ring-brand/30" onClick={() => setShowAnswer((v) => !v)}>
          {showAnswer ? '隐藏答案' : '显示答案'}
        </button>
        <button type="button" disabled={busy} className="rounded-full bg-brand px-3 py-1 text-xs text-white disabled:opacity-60" onClick={() => void mark('correct')}>
          做对了
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
    </article>
  );
}

function PracticeBoard({ tab, onWrong }: PracticeBoardProps) {
  const today = todayISO();
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [review, setReview] = useState<PracticeQuestion[]>([]);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const reload = useCallback(async () => {
    const res = await listPractice(today);
    setQuestions(res.questions);
    setReview(res.review);
  }, [today]);

  useEffect(() => {
    void reload().catch((err) => {
      setMessage(err instanceof ApiError ? err.message : '练习题加载失败');
    });
  }, [reload]);

  const generate = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await generatePractice(today);
      setMessage(res.questions.length ? `已生成 ${res.questions.length} 题` : '今天还没有完成的任务，先去勾选今天的任务');
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
