import { motion } from 'framer-motion';

import { Magnet } from '@/components/motion';
import { useAssistantStore } from '@/store';
import type { Mistake, ReviewStatus } from '@/mocks/types';

/**
 * MistakeDetail — 错题本右侧错题详情（需求 6.3、6.4、6.5、18.18、18.4）
 *
 * 动效（任务 28）：
 * - 四块卡片以 motion.article initial/animate + 延迟依次淡入（原题 0.1s、我的答案 0.2s、
 *   为什么错 0.15s、正确理解 0.3s，需求 18.18）；父层用 AnimatePresence + key 重挂载时
 *   每次挂载都会重播（用 initial/animate 而非 whileInView once）。
 * - 底部「回到学习助手重新做一道」按钮用 Magnet 磁吸包裹（strength 3 / padding 150，需求 18.4）。
 * 结构与配色保持不变：
 * - 四块卡片：原题（深墨绿底白字 bg-brandDark）、我的答案（浅红底红字 bg-danger）、
 *   为什么错（普通白卡）、正确理解（浅绿底 bg-brandLight），均保留大圆角；
 * - 底部按钮（.btn-pill，前端占位）右侧展示复习安排状态（中文映射 + nextReviewAt 若有）。
 */

/** 卡片依次淡入的过渡工厂：每张卡片给不同 delay 形成错落感 */
const cardFadeIn = (delay: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] as const },
});

/** 复习状态 → 中文标签映射 */
const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: '待复习',
  scheduled: '已安排',
  done: '已完成',
};

/** 把 ISO 时间格式化为本地日期，无值时返回 null。 */
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

export interface MistakeDetailProps {
  /** 当前选中的错题；无选中时展示空态 */
  mistake: Mistake | null;
  /**
   * 可选回调：若上层需要额外响应「回到学习助手」，可传入。
   * 无论是否传入，本组件都会调用 store.openAssistantWithContext 唤起悬浮窗（需求 6.6）。
   */
  onBackToAssistant?: (mistake: Mistake) => void;
  /** 更新复习安排状态（真实 PATCH） */
  onReviewStatusChange?: (status: ReviewStatus) => void;
}

function MistakeDetail({
  mistake,
  onBackToAssistant,
  onReviewStatusChange,
}: MistakeDetailProps) {
  const openAssistantWithContext = useAssistantStore(
    (s) => s.openAssistantWithContext,
  );

  if (!mistake) {
    return (
      <section className="card flex min-h-[240px] items-center justify-center p-8 text-center text-gray-500">
        从左侧复习队列选择一条错题查看详情
      </section>
    );
  }

  const reviewDate = formatReviewDate(mistake.nextReviewAt);

  const handleBack = () => {
    // 唤起并打开悬浮窗、注入错题上下文、保留历史消息（需求 6.6 / 8.10 / 8.11）。
    // 再次点击传入新上下文时由 store 覆盖 context 且保留 messages。
    openAssistantWithContext({
      type: 'mistake',
      refId: mistake.id,
      hint: '重新做这道错题',
    });
    onBackToAssistant?.(mistake);
  };

  return (
    <section className="flex flex-col gap-4">
      {/* 原题：深墨绿底白字（延迟 0.1s 淡入） */}
      <motion.article className="card bg-brandDark p-6 text-white" {...cardFadeIn(0.1)}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brandLight">
          原题
        </h3>
        <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed">
          {mistake.question}
        </p>
      </motion.article>

      {/* 我的答案：浅红底红字（延迟 0.2s 淡入） */}
      <motion.article className="card bg-danger p-6 text-dangerText" {...cardFadeIn(0.2)}>
        <h3 className="text-sm font-semibold uppercase tracking-wide">我的答案</h3>
        <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed">
          {mistake.myAnswer}
        </p>
      </motion.article>

      {/* 为什么错：普通白卡（延迟 0.15s 淡入，居中错落） */}
      <motion.article className="card p-6" {...cardFadeIn(0.15)}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brand">
          为什么错
        </h3>
        <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-brandDark">
          {mistake.whyWrong}
        </p>
      </motion.article>

      {/* 正确理解：浅绿底（延迟 0.3s 淡入） */}
      <motion.article className="card bg-brandLight p-6 text-brandDark" {...cardFadeIn(0.3)}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brandDark/70">
          正确理解
        </h3>
        <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed">
          {mistake.correctUnderstanding}
        </p>
      </motion.article>

      {/* 底部：按钮（左） + 复习安排状态（右） */}
      <footer className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
        <Magnet strength={3} padding={150} className="self-start sm:self-auto">
          <button
            type="button"
            onClick={handleBack}
            className="btn-pill px-6 py-3 text-sm font-semibold"
          >
            回到学习助手重新做一道
          </button>
        </Magnet>

        <div className="text-sm text-gray-500 sm:text-right">
          <span className="mr-2">复习安排</span>
          <span className="rounded-full bg-brandFaint px-3 py-1 font-medium text-brandDark">
            {REVIEW_STATUS_LABEL[mistake.reviewStatus]}
          </span>
          {reviewDate ? (
            <span className="ml-2">下次 {reviewDate}</span>
          ) : null}
          {onReviewStatusChange ? (
            <div className="mt-2 flex flex-wrap justify-end gap-1.5">
              {(['pending', 'scheduled', 'done'] as ReviewStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={mistake.reviewStatus === s}
                  onClick={() => onReviewStatusChange(s)}
                  className="rounded-full border border-brandFaint px-2.5 py-0.5 text-xs text-brandDark enabled:hover:bg-brandFaint disabled:opacity-40"
                >
                  {REVIEW_STATUS_LABEL[s]}
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
