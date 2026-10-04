import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

import { Magnet } from '@/components/motion';
import { useAssistantStore } from '@/store';
import type { Mistake, ReviewStatus } from '@/mocks/types';

/** 卡片依次淡入的过渡工厂：每张卡片给不同 delay 形成错落感 */
const cardFadeIn = (delay: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] as const },
});

const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: '待复习',
  scheduled: '已安排',
  done: '已完成',
};

function formatReviewDate(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export interface MistakeEditValues {
  question: string;
  myAnswer: string;
  whyWrong: string;
  correctUnderstanding: string;
}

export interface MistakeDetailProps {
  mistake: Mistake | null;
  onBackToAssistant?: (mistake: Mistake) => void;
  onReviewStatusChange?: (status: ReviewStatus) => void;
  onDelete?: () => void;
  deleting?: boolean;
  onSave?: (values: MistakeEditValues) => Promise<void>;
  saving?: boolean;
}

function MistakeDetail({
  mistake,
  onBackToAssistant,
  onReviewStatusChange,
  onDelete,
  deleting = false,
  onSave,
  saving = false,
}: MistakeDetailProps) {
  const openAssistantWithContext = useAssistantStore(
    (s) => s.openAssistantWithContext,
  );
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState('');
  const [myAnswer, setMyAnswer] = useState('');
  const [whyWrong, setWhyWrong] = useState('');
  const [correctUnderstanding, setCorrectUnderstanding] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setFormError(null);
    if (!mistake) return;
    setQuestion(mistake.question);
    setMyAnswer(mistake.myAnswer);
    setWhyWrong(mistake.whyWrong);
    setCorrectUnderstanding(mistake.correctUnderstanding);
  }, [mistake]);

  if (!mistake) {
    return (
      <section className="card flex min-h-[240px] items-center justify-center p-8 text-center text-gray-500">
        从左侧复习队列选择一条错题查看详情
      </section>
    );
  }

  const reviewDate = formatReviewDate(mistake.nextReviewAt);
  const due =
    mistake.reviewStatus === 'scheduled' &&
    !!mistake.nextReviewAt &&
    new Date(mistake.nextReviewAt).getTime() <= Date.now();

  const handleBack = () => {
    openAssistantWithContext({
      type: 'mistake',
      refId: mistake.id,
      hint: '重新做这道错题',
    });
    onBackToAssistant?.(mistake);
  };

  const submitEdit = async () => {
    const cleaned = question.trim();
    if (!cleaned) {
      setFormError('原题不能为空');
      return;
    }
    if (!onSave) return;
    setFormError(null);
    try {
      await onSave({
        question: cleaned,
        myAnswer: myAnswer.trim(),
        whyWrong: whyWrong.trim(),
        correctUnderstanding: correctUnderstanding.trim(),
      });
      setEditing(false);
    } catch {
      // 失败提示由页面写入
    }
  };

  if (editing) {
    return (
      <section className="card space-y-3 p-6">
        <p className="text-sm font-semibold text-brandDark">编辑错题</p>
        <label className="block text-xs text-gray-500">
          原题（必填）
          <textarea
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="mt-1 w-full rounded-xl border border-brandFaint bg-white px-3 py-2 text-sm text-brandDark"
          />
        </label>
        <label className="block text-xs text-gray-500">
          我的答案
          <textarea
            rows={2}
            value={myAnswer}
            onChange={(e) => setMyAnswer(e.target.value)}
            className="mt-1 w-full rounded-xl border border-brandFaint bg-white px-3 py-2 text-sm text-brandDark"
          />
        </label>
        <label className="block text-xs text-gray-500">
          为什么错
          <textarea
            rows={2}
            value={whyWrong}
            onChange={(e) => setWhyWrong(e.target.value)}
            className="mt-1 w-full rounded-xl border border-brandFaint bg-white px-3 py-2 text-sm text-brandDark"
          />
        </label>
        <label className="block text-xs text-gray-500">
          正确理解
          <textarea
            rows={2}
            value={correctUnderstanding}
            onChange={(e) => setCorrectUnderstanding(e.target.value)}
            className="mt-1 w-full rounded-xl border border-brandFaint bg-white px-3 py-2 text-sm text-brandDark"
          />
        </label>
        {formError ? <p className="text-xs text-dangerText">{formError}</p> : null}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void submitEdit()}
            className="rounded-full bg-brandDark px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存修改'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setEditing(false);
              setQuestion(mistake.question);
              setMyAnswer(mistake.myAnswer);
              setWhyWrong(mistake.whyWrong);
              setCorrectUnderstanding(mistake.correctUnderstanding);
              setFormError(null);
            }}
            className="rounded-full bg-bg px-4 py-2 text-sm font-medium text-brandDark"
          >
            取消
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <motion.article className="card bg-brandDark p-6 text-white" {...cardFadeIn(0.1)}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brandLight">
          原题
        </h3>
        <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed">
          {mistake.question}
        </p>
      </motion.article>

      <motion.article className="card bg-danger p-6 text-dangerText" {...cardFadeIn(0.2)}>
        <h3 className="text-sm font-semibold uppercase tracking-wide">我的答案</h3>
        <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed">
          {mistake.myAnswer}
        </p>
      </motion.article>

      <motion.article className="card p-6" {...cardFadeIn(0.15)}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brand">
          为什么错
        </h3>
        <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-brandDark">
          {mistake.whyWrong}
        </p>
      </motion.article>

      <motion.article className="card bg-brandLight p-6 text-brandDark" {...cardFadeIn(0.3)}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brandDark/70">
          正确理解
        </h3>
        <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed">
          {mistake.correctUnderstanding}
        </p>
      </motion.article>

      <footer className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <Magnet strength={3} padding={150} className="self-start sm:self-auto">
            <button
              type="button"
              onClick={handleBack}
              className="btn-pill px-6 py-3 text-sm font-semibold"
            >
              回到学习助手重新做一道
            </button>
          </Magnet>
          {onSave ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-full border border-brandFaint px-4 py-2 text-sm font-medium text-brandDark hover:bg-brandFaint"
            >
              编辑
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              disabled={deleting}
              onClick={onDelete}
              className="rounded-full border border-danger/40 px-4 py-2 text-sm font-medium text-dangerText hover:bg-danger disabled:opacity-60"
            >
              {deleting ? '删除中…' : '删除这条错题'}
            </button>
          ) : null}
        </div>

        <div className="text-sm text-gray-500 sm:text-right">
          <span className="mr-2">复习安排</span>
          <span
            className={`rounded-full px-3 py-1 font-medium ${due ? 'bg-dangerText text-white' : 'bg-brandFaint text-brandDark'}`}
          >
            {due ? '今天该复习' : REVIEW_STATUS_LABEL[mistake.reviewStatus]}
          </span>
          {reviewDate && !due ? <span className="ml-2">下次 {reviewDate}</span> : null}
          {onReviewStatusChange ? (
            <div className="mt-2 flex flex-wrap justify-end gap-1.5">
              {(['pending', 'scheduled', 'done'] as ReviewStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={s !== 'scheduled' && mistake.reviewStatus === s}
                  onClick={() => onReviewStatusChange(s)}
                  className="rounded-full border border-brandFaint px-2.5 py-0.5 text-xs text-brandDark enabled:hover:bg-brandFaint disabled:opacity-40"
                >
                  {s === 'scheduled' && due
                    ? '复习完了，排下一次'
                    : s === 'scheduled' && mistake.reviewStatus === 'scheduled'
                      ? '排下一次'
                      : REVIEW_STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </footer>
    </section>
  );
}

export default MistakeDetail;
