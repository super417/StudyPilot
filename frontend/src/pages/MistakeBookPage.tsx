import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Camera, ImageUp, Plus, Sparkles, X } from 'lucide-react';
import { useAssistantStore, selectActiveMessages } from '@/store';
import { latestExplainReply } from '@/lib/explainFill';

import MistakeList from '@/components/MistakeList';
import PracticeBoard from '@/components/PracticeBoard';
import MistakeDetail from '@/components/MistakeDetail';
import CameraCapture from '@/components/CameraCapture';
import type { Mistake, ReviewStatus } from '@/mocks/types';
import {
  createMistake,
  deleteMistake,
  dueFirst,
  getMistake,
  listItemToMistake,
  listMistakes,
  matchQueueFilter,
  recognizeQuestionImage,
  setMistakeReviewStatus,
  takeMistakeFilter,
  updateMistake,
  type QueueFilter,
} from '@/lib/mistakesApi';
import { todayISO } from '@/lib/dates';
import { ApiError } from '@/lib/httpClient';
import type { MistakeEditValues } from '@/components/MistakeDetail';

function MistakeBookPage() {
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Mistake | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingSave, setEditingSave] = useState(false);
  const [question, setQuestion] = useState('');
  const [myAnswer, setMyAnswer] = useState('');
  const [whyWrong, setWhyWrong] = useState('');
  const [correctUnderstanding, setCorrectUnderstanding] = useState('');
  const [recognizing, setRecognizing] = useState(false);
  const [board, setBoard] = useState<'practice' | 'mistakes'>('mistakes');
  const [practiceTab, setPracticeTab] = useState<'today' | 'review'>('today');
  const [mistakeFilter, setMistakeFilter] = useState<QueueFilter | 'today'>('all');

  const [cameraOpen, setCameraOpen] = useState(false);
  const captureInputRef = useRef<HTMLInputElement>(null);
  const assistantMessages = useAssistantStore(selectActiveMessages);
  const assistantStreaming = useAssistantStore((s) => s.streaming);
  const explainFill = latestExplainReply(assistantMessages, assistantStreaming);

  const fillFromAssistant = () => {
    if (!explainFill) return;
    setCorrectUnderstanding(explainFill.correctUnderstanding);
    if (explainFill.whyWrong) setWhyWrong(explainFill.whyWrong);
    setActionMsg('已填入助手刚才的讲解，核对后再加入复习队列');
  };

  const openCamera = () => {
    if (window.isSecureContext && 'mediaDevices' in navigator) {
      setCameraOpen(true);
    } else {
      // 非安全来源（如手机用局域网 http 打开）拿不到摄像头接口，退回系统相机
      captureInputRef.current?.click();
    }
  };

  const askAssistant = () => {
    const q = question.trim();
    if (!q) return;
    const lines = [`帮我讲这道题：先说考点，再给解题思路和完整步骤，最后点出最容易错的地方。`, '', q];
    if (myAnswer.trim()) lines.push('', `我的答案：${myAnswer.trim()}`, '请顺便指出我错在哪。');
    const prompt = lines.join('\n');
    const { openAssistantWithContext, queuePrompt } = useAssistantStore.getState();
    openAssistantWithContext({ type: 'free', hint: '讲解这道题' });
    queuePrompt(prompt);
  };

  const handleImage = (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (file) void recognizeFile(file);
  };

  const recognizeFile = async (file: File) => {
    if (recognizing) return;
    setRecognizing(true);
    setActionMsg(null);
    try {
      const res = await recognizeQuestionImage(file);
      setShowForm(true);
      setQuestion((prev) => (prev.trim() ? `${prev.trim()}\n${res.text}` : res.text));
      setActionMsg('已识别题目，核对一下；可以直接「让助手讲这道题」，或保存进复习队列');
    } catch (err) {
      setActionMsg(err instanceof ApiError ? err.message : '识别失败，请稍后重试');
    } finally {
      setRecognizing(false);
    }
  };

  const reloadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listMistakes();
      const items = dueFirst(res.mistakes.map(listItemToMistake));
      setMistakes(items);
      setPendingCount(res.pendingCount);
      setSelectedId((prev) => {
        if (prev && items.some((m) => m.id === prev)) return prev;
        return items[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '习题本加载失败');
      setMistakes([]);
      setPendingCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadList();
  }, [reloadList]);

  useEffect(() => {
    const apply = () => {
      const next = takeMistakeFilter();
      if (!next) return;
      setBoard('mistakes');
      setMistakeFilter(next);
    };
    apply();
    window.addEventListener('studypilot:mistake-filter', apply);
    return () => window.removeEventListener('studypilot:mistake-filter', apply);
  }, []);

  useEffect(() => {
    const open = () => setShowForm(true);
    window.addEventListener('studypilot:open-mistake-form', open);
    if (window.location.hash === '#new-mistake') {
      setShowForm(true);
    }
    return () => window.removeEventListener('studypilot:open-mistake-form', open);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    getMistake(selectedId)
      .then((res) => {
        if (active) setDetail(res.mistake);
      })
      .catch((e) => {
        if (active) {
          setDetail(null);
          setActionMsg(e instanceof ApiError ? e.message : '错题详情加载失败');
        }
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  const handleReviewStatus = async (status: ReviewStatus) => {
    if (!selectedId) return;
    setActionMsg(null);
    try {
      const res = await setMistakeReviewStatus(selectedId, status);
      setMistakes((prev) =>
        prev.map((m) =>
          m.id === selectedId
            ? {
                ...m,
                reviewStatus: res.mistake.reviewStatus,
                nextReviewAt: res.mistake.nextReviewAt ?? undefined,
                due: false,
              }
            : m,
        ),
      );
      setDetail((prev) =>
        prev && prev.id === selectedId
          ? {
              ...prev,
              reviewStatus: res.mistake.reviewStatus,
              nextReviewAt: res.mistake.nextReviewAt ?? undefined,
            }
          : prev,
      );
      setPendingCount((prev) => {
        const before = mistakes.find((m) => m.id === selectedId)?.reviewStatus;
        let next = prev;
        if (before === 'pending' && status !== 'pending') next -= 1;
        if (before !== 'pending' && status === 'pending') next += 1;
        return Math.max(0, next);
      });
      setActionMsg('复习状态已更新');
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : '更新复习状态失败');
    }
  };

  const handleDelete = async () => {
    if (!selectedId || deleting) return;
    setDeleting(true);
    setActionMsg(null);
    try {
      await deleteMistake(selectedId);
      setActionMsg('已删除这条错题');
      setDetail(null);
      await reloadList();
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : '删除失败，请稍后重试');
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveEdit = async (values: MistakeEditValues) => {
    if (!selectedId || editingSave) return;
    setEditingSave(true);
    setActionMsg(null);
    try {
      const res = await updateMistake(selectedId, values);
      const updated = res.mistake;
      setDetail(updated);
      setMistakes((prev) =>
        prev.map((m) =>
          m.id === selectedId
            ? { ...m, question: updated.question, reviewStatus: updated.reviewStatus }
            : m,
        ),
      );
      setActionMsg('错题已更新');
    } catch (e) {
      setActionMsg(e instanceof ApiError ? e.message : '保存失败，请稍后重试');
      throw e;
    } finally {
      setEditingSave(false);
    }
  };

  const applyExplain = async () => {
    if (!detail || !explainFill || editingSave) return;
    await handleSaveEdit({
      question: detail.question,
      myAnswer: detail.myAnswer,
      whyWrong: explainFill.whyWrong || detail.whyWrong,
      correctUnderstanding: explainFill.correctUnderstanding,
    });
    setActionMsg('已把讲解写入这条错题');
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const q = question.trim();
    if (!q) {
      setActionMsg('请填写原题内容');
      return;
    }
    setSaving(true);
    setActionMsg(null);
    try {
      const res = await createMistake({
        question: q,
        myAnswer: myAnswer.trim() || undefined,
        whyWrong: whyWrong.trim() || undefined,
        correctUnderstanding: correctUnderstanding.trim() || undefined,
      });
      setQuestion('');
      setMyAnswer('');
      setWhyWrong('');
      setCorrectUnderstanding('');
      setShowForm(false);
      setSelectedId(res.mistake.id);
      setActionMsg('错题已加入复习队列');
      await reloadList();
      setSelectedId(res.mistake.id);
    } catch (err) {
      setActionMsg(err instanceof ApiError ? err.message : '录入失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const selectedIndex =
    selectedId == null ? 0 : mistakes.findIndex((m) => m.id === selectedId);
  const bookOrdinal =
    selectedIndex >= 0 ? String(selectedIndex + 1).padStart(2, '0') : '01';

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p
            className="text-xs font-bold uppercase tracking-[0.18em] text-dangerText"
            style={{ color: '#D84C31' }}
          >
            {`MISTAKE BOOK · ${bookOrdinal}`}
          </p>
          <h1 className="mt-3 font-display text-3xl font-black leading-tight tracking-tight text-brandDark sm:text-4xl">
            错题不是收藏，是下一次真的会做
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-500 sm:text-base">
            每一条都保留原题、我的答案、错因、正确理解和复习安排。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={recognizing}
            onClick={openCamera}
            className="inline-flex items-center gap-1.5 rounded-full border border-brandDark/20 bg-white px-4 py-2 text-sm font-medium text-brandDark transition hover:bg-brandFaint disabled:opacity-60"
          >
            <Camera size={16} aria-hidden="true" />
            拍照识题
          </button>
          <input
            ref={captureInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={handleImage}
          />
          <label
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-brandDark/20 bg-white px-4 py-2 text-sm font-medium text-brandDark transition hover:bg-brandFaint ${recognizing ? 'pointer-events-none opacity-60' : ''}`}
          >
            <ImageUp size={16} aria-hidden="true" />
            {recognizing ? '识别中…' : '上传图片'}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={recognizing}
              onChange={handleImage}
            />
          </label>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full bg-brandDark px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            {showForm ? <X size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
            {showForm ? '收起表单' : '记录一道错题'}
          </button>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          {error}
          <button type="button" className="ml-3 underline" onClick={() => void reloadList()}>
            重试
          </button>
        </div>
      ) : null}
      {actionMsg ? <p className="text-sm text-brandDark">{actionMsg}</p> : null}

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => {
          setCameraOpen(false);
          void recognizeFile(file);
        }}
      />

      {showForm ? (
        <form
          onSubmit={(ev) => void handleCreate(ev)}
          className="space-y-3 rounded-3xl border border-brandFaint bg-white/90 p-5 shadow-sm"
        >
          <p className="text-sm font-semibold text-brandDark">录入错题</p>
          <label className="block">
            <span className="text-xs text-gray-500">原题（必填）</span>
            <textarea
              required
              rows={3}
              value={question}
              onChange={(ev) => setQuestion(ev.target.value)}
              placeholder="把题目原文贴进来"
              className="mt-1 w-full rounded-xl border border-brandFaint bg-white px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-gray-500">我的答案</span>
              <textarea
                rows={2}
                value={myAnswer}
                onChange={(ev) => setMyAnswer(ev.target.value)}
                className="mt-1 w-full rounded-xl border border-brandFaint bg-white px-3 py-2 text-sm outline-none focus:border-brand"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">为什么错</span>
              <textarea
                rows={2}
                value={whyWrong}
                onChange={(ev) => setWhyWrong(ev.target.value)}
                className="mt-1 w-full rounded-xl border border-brandFaint bg-white px-3 py-2 text-sm outline-none focus:border-brand"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-gray-500">正确理解</span>
            <textarea
              rows={2}
              value={correctUnderstanding}
              onChange={(ev) => setCorrectUnderstanding(ev.target.value)}
              className="mt-1 w-full rounded-xl border border-brandFaint bg-white px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-full bg-brandDark px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? '保存中…' : '加入复习队列'}
            </button>
            <button
              type="button"
              disabled={!question.trim()}
              onClick={askAssistant}
              className="inline-flex items-center gap-1.5 rounded-full border border-brandDark/20 bg-white px-4 py-2 text-sm font-medium text-brandDark hover:bg-brandFaint disabled:opacity-50"
            >
              <Sparkles size={15} aria-hidden="true" />
              让助手讲这道题
            </button>
            {explainFill ? (
              <button
                type="button"
                onClick={fillFromAssistant}
                className="inline-flex items-center gap-1.5 rounded-full border border-brandDark/20 bg-white px-4 py-2 text-sm font-medium text-brandDark hover:bg-brandFaint"
              >
                把讲解填回来
              </button>
            ) : null}
          </div>
          <p className="text-xs text-gray-400">
            讲题不会保存错题。助手讲完后点「把讲解填回来」，核对错因和正确理解，再加入复习队列。
          </p>
        </form>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <nav className="card mb-4 space-y-3 p-4" aria-label="习题本分区">
            <div>
              <button type="button" className={`text-sm font-semibold ${board === 'practice' ? 'text-brand' : 'text-brandDark'}`} onClick={() => setBoard('practice')}>
                习题
              </button>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <button type="button" className="rounded-full bg-brandFaint px-2.5 py-0.5 text-xs text-brandDark" onClick={() => { setBoard('practice'); setPracticeTab('today'); }}>今日练习</button>
                <button type="button" className="rounded-full bg-brandFaint px-2.5 py-0.5 text-xs text-brandDark" onClick={() => { setBoard('practice'); setPracticeTab('review'); }}>今日复习</button>
              </div>
            </div>
            <div>
              <button type="button" className={`text-sm font-semibold ${board === 'mistakes' ? 'text-brand' : 'text-brandDark'}`} onClick={() => setBoard('mistakes')}>
                错题
              </button>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {([
                  ['today', '今日错题'],
                  ['all', '全部'],
                  ['pending', '待复习'],
                  ['scheduled', '已安排'],
                  ['done', '已完成'],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`rounded-full px-2.5 py-0.5 text-xs ${board === 'mistakes' && mistakeFilter === id ? 'bg-brandDark text-white' : 'bg-brandFaint text-brandDark'}`}
                    onClick={() => {
                      setBoard('mistakes');
                      setMistakeFilter(id);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </nav>
          {board === 'mistakes' ? (
            loading ? (
              <section className="card p-6 text-sm text-gray-400">加载错题队列…</section>
            ) : mistakes.length === 0 ? (
              <section className="card p-6 text-sm text-gray-500">
                暂无错题。点右上角「记录一道错题」开始积累复习队列。
              </section>
            ) : (
              <MistakeList
                mistakes={
                  mistakeFilter === 'today'
                    ? mistakes.filter((item) => item.createdAt?.slice(0, 10) === todayISO())
                    : mistakes.filter((item) => matchQueueFilter(item, mistakeFilter))
                }
                selectedId={selectedId}
                onSelect={setSelectedId}
                pendingCount={pendingCount}
                controlledFilter="all"
              />
            )
          ) : null}
        </div>
        <div className="lg:col-span-2">
          {board === 'practice' ? (
            <div className="space-y-4">
              <PracticeBoard tab={practiceTab} onWrong={() => void reloadList()} />
              {practiceTab === 'review' ? (
                <MistakeList
                  mistakes={mistakes.filter((item) => item.due)}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    setSelectedId(id);
                    setBoard('mistakes');
                    setMistakeFilter('due');
                  }}
                  pendingCount={pendingCount}
                  controlledFilter="all"
                />
              ) : null}
            </div>
          ) : null}
          {board === 'mistakes' ? (
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedId ?? 'empty'}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              {detailLoading ? (
                <section className="card p-8 text-sm text-gray-400">加载错题详情…</section>
              ) : (
                <MistakeDetail
                  mistake={detail}
                  onReviewStatusChange={handleReviewStatus}
                  onDelete={() => void handleDelete()}
                  deleting={deleting}
                  onSave={handleSaveEdit}
                  saving={editingSave}
                  onApplyExplain={explainFill ? () => void applyExplain() : undefined}
                />
              )}
            </motion.div>
          </AnimatePresence>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default MistakeBookPage;
