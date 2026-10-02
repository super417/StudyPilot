import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, X } from 'lucide-react';

import MistakeList from '@/components/MistakeList';
import MistakeDetail from '@/components/MistakeDetail';
import type { Mistake, ReviewStatus } from '@/mocks/types';
import {
  createMistake,
  getMistake,
  listItemToMistake,
  listMistakes,
  setMistakeReviewStatus,
} from '@/lib/mistakesApi';
import { ApiError } from '@/lib/httpClient';

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
  const [question, setQuestion] = useState('');
  const [myAnswer, setMyAnswer] = useState('');
  const [whyWrong, setWhyWrong] = useState('');
  const [correctUnderstanding, setCorrectUnderstanding] = useState('');

  const reloadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listMistakes();
      const items = res.mistakes.map(listItemToMistake);
      setMistakes(items);
      setPendingCount(res.pendingCount);
      setSelectedId((prev) => {
        if (prev && items.some((m) => m.id === prev)) return prev;
        return items[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '错题本加载失败');
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
          m.id === selectedId ? { ...m, reviewStatus: res.mistake.reviewStatus } : m,
        ),
      );
      setDetail((prev) =>
        prev && prev.id === selectedId
          ? { ...prev, reviewStatus: res.mistake.reviewStatus }
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
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full bg-brandDark px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          {showForm ? <X size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
          {showForm ? '收起表单' : '记录一道错题'}
        </button>
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
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-brandDark px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? '保存中…' : '加入复习队列'}
          </button>
        </form>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          {loading ? (
            <section className="card p-6 text-sm text-gray-400">加载错题队列…</section>
          ) : mistakes.length === 0 ? (
            <section className="card p-6 text-sm text-gray-500">
              暂无错题。点右上角「记录一道错题」开始积累复习队列。
            </section>
          ) : (
            <MistakeList
              mistakes={mistakes}
              selectedId={selectedId}
              onSelect={setSelectedId}
              pendingCount={pendingCount}
            />
          )}
        </div>
        <div className="lg:col-span-2">
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
                <MistakeDetail mistake={detail} onReviewStatusChange={handleReviewStatus} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default MistakeBookPage;
