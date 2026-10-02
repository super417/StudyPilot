import { motion } from 'framer-motion';

import type { Mistake, ReviewStatus } from '@/mocks/types';

/**
 * MistakeList / MistakeListItem — 错题本左侧复习队列（需求 6.1、6.2、18.17）
 *
 * 动效（任务 28，需求 18.17）：
 * - 列表项 hover 时轻微浮起（y:-2 + 轻阴影），平滑弹性过渡，不破坏列表语义与选中态；
 * - 选中项保留左侧 brand 指示条 + brandFaint 高亮底。
 * 结构：
 * - 列表头展示「Review Queue / 复习队列」标题 + 待复习数量角标
 *   （角标数量 = reviewStatus==='pending' 的错题数，brand 主色徽标）；
 * - 每个列表项展示题干摘要（截断）与复习状态中文标签；
 * - 选中项以左侧 brand 指示条 + brandFaint 高亮底区分。
 */

/** 复习状态 → 中文标签映射 */
const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: '待复习',
  scheduled: '已安排',
  done: '已完成',
};

/** 复习状态 → 状态标签配色（浅底 + 深字，保持薄荷绿视觉体系） */
const REVIEW_STATUS_STYLE: Record<ReviewStatus, string> = {
  pending: 'bg-danger text-dangerText',
  scheduled: 'bg-brandFaint text-brandDark',
  done: 'bg-brandLight text-brandDark',
};

export interface MistakeListItemProps {
  /** 单条错题数据 */
  mistake: Mistake;
  /** 是否为当前选中项 */
  isSelected: boolean;
  /** 点击选中回调 */
  onSelect: (id: string) => void;
}

function MistakeListItem({ mistake, isSelected, onSelect }: MistakeListItemProps) {
  return (
    // 视口内渲染优化（需求 18.28）：复习队列条目数随错题增长可能很长，
    // 用 content-visibility:auto 跳过屏外条目的布局/绘制；contain-intrinsic-size
    // 给单项约 96px 的占位高度估算，避免屏外条目被跳过时滚动跳动。
    <li className="cv-list" style={{ containIntrinsicSize: 'auto 96px' }}>
      <motion.button
        type="button"
        onClick={() => onSelect(mistake.id)}
        aria-pressed={isSelected}
        // will-change:transform（需求 18.28）：提示浏览器为 hover 位移提前建立合成层。
        style={{ willChange: 'transform' }}
        whileHover={{ y: -2, boxShadow: '0 8px 20px -12px rgba(15, 118, 110, 0.45)' }}
        whileTap={{ y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
        className={[
          'flex w-full items-start gap-3 rounded-3xl px-4 py-4 text-left',
          isSelected ? 'bg-brandFaint' : 'bg-transparent hover:bg-brandFaint/50',
        ].join(' ')}
      >
        {/* 左侧选中指示条 */}
        <span
          className={[
            'mt-1 h-10 w-1.5 shrink-0 rounded-full',
            isSelected ? 'bg-brand' : 'bg-transparent',
          ].join(' ')}
          aria-hidden="true"
        />

        <span className="min-w-0 flex-1">
          {/* 题干摘要（截断为两行） */}
          <span className="line-clamp-2 block text-sm font-medium text-brandDark">
            {mistake.question}
          </span>

          {/* 复习状态标签 */}
          <span
            className={[
              'mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium',
              REVIEW_STATUS_STYLE[mistake.reviewStatus],
            ].join(' ')}
          >
            {REVIEW_STATUS_LABEL[mistake.reviewStatus]}
          </span>
        </span>
      </motion.button>
    </li>
  );
}

export interface MistakeListProps {
  /** 全部错题 */
  mistakes: Mistake[];
  /** 当前选中错题 id */
  selectedId: string | null;
  /** 选中回调 */
  onSelect: (id: string) => void;
  /** 待复习角标；缺省则按列表内 pending 计数 */
  pendingCount?: number;
}

function MistakeList({ mistakes, selectedId, onSelect, pendingCount }: MistakeListProps) {
  const badge =
    pendingCount ?? mistakes.filter((m) => m.reviewStatus === 'pending').length;

  return (
    <section className="card flex flex-col overflow-hidden p-5 sm:p-6">
      {/* 列表头：标题 + 待复习数量角标 */}
      <header className="flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-brandDark">
            Review Queue
          </h2>
          <p className="text-sm text-gray-500">复习队列</p>
        </div>
        <span className="shrink-0 rounded-full bg-brand px-3 py-1 text-sm font-semibold text-white">
          {badge} 待复习
        </span>
      </header>

      {/* 错题列表 */}
      <ul className="mt-4 flex flex-col gap-1">
        {mistakes.map((mistake) => (
          <MistakeListItem
            key={mistake.id}
            mistake={mistake}
            isSelected={mistake.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </section>
  );
}

export default MistakeList;
