import { motion } from 'framer-motion';
import type { Phase } from '@/mocks/types';
import { FADE_IN_EASE } from './motion/utils';

/**
 * PhaseList / PhaseItem — Roadmap 阶段列表（需求 5.2、5.3、12.11、18.14、18.15、18.16）
 *
 * - 每个阶段一行，左侧超大阶段数字（font-display font-black text-brandDark，
 *   字号 clamp(3rem, 8vw, 140px)、leading-none）；
 * - 右侧展示阶段名称、日期范围、细进度条（brand 主色 + brandFaint 底槽）与百分比文字；
 * - 当前阶段（isCurrent）整项薄荷绿高亮，其余白底（需求 18.15，静态实现，勿破坏）；
 * - 列表项之间用极浅绿 brandFaint 的 1px 分割线（divide-y divide-brandFaint）；
 * - 动效（任务 27）：
 *   · 第 i 个阶段列表项以 i × 0.1 秒延迟交错入场（需求 18.14），从 opacity:0 + y:24 淡入；
 *   · 光标悬停时卡片向右平移（x:10）并加深阴影（需求 18.16），平滑过渡。
 */

/** motion 版列表项，保持 <li> 列表语义不变。 */
const MotionLi = motion.create('li');

export interface PhaseItemProps {
  /** 单个阶段数据 */
  phase: Phase;
  /** 阶段在列表中的序号（从 0 开始），用于交错入场延迟 */
  index: number;
}

/** 把 clamp(...) 的进度值约束到 0-100，避免异常数据溢出进度条。 */
function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function PhaseItem({ phase, index }: PhaseItemProps) {
  const percent = clampPercent(phase.progressPercent);

  return (
    <MotionLi
      className={[
        'relative flex items-center gap-5 px-5 py-6 will-change-transform sm:gap-8 sm:px-8',
        // 视口内渲染优化（需求 18.28）：阶段列表随规划阶段数增长，cv-list 跳过屏外
        // 阶段项的布局/绘制；contain-intrinsic-size 给每项约 148px 占位估算防跳动。
        // 与 whileInView 入场互补：cv 跳渲染、whileInView 控入场，均针对屏外元素。
        'cv-list',
        phase.isCurrent ? 'bg-brandLight' : 'bg-card',
      ].join(' ')}
      style={{ transformOrigin: 'left center', containIntrinsicSize: 'auto 148px' }}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '50px', amount: 0 }}
      transition={{ delay: index * 0.1, duration: 0.6, ease: FADE_IN_EASE }}
      whileHover={{
        x: 10,
        boxShadow: '0 18px 40px -12px rgba(16, 87, 60, 0.35)',
        transition: { duration: 0.25, ease: FADE_IN_EASE },
      }}
    >
      {/* 左侧超大阶段数字 */}
      <span
        className="shrink-0 font-display font-black leading-none text-brandDark"
        style={{ fontSize: 'clamp(3rem, 8vw, 140px)' }}
      >
        {phase.phaseIndex}
      </span>

      {/* 右侧：名称 / 日期范围 / 进度 */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-lg font-semibold text-brandDark sm:text-xl">
            {phase.name}
          </h3>
          {phase.isCurrent ? (
            <span className="shrink-0 rounded-full bg-brandDark px-3 py-0.5 text-xs font-medium text-white">
              当前阶段
            </span>
          ) : phase.isCompleted ? (
            <span className="shrink-0 rounded-full bg-brandFaint px-3 py-0.5 text-xs font-medium text-brandDark">
              已完成
            </span>
          ) : null}
        </div>

        <p className="mt-1 text-sm text-gray-500">
          {phase.startDate} ~ {phase.endDate}
        </p>

        {/* 细进度条 + 百分比 */}
        <div className="mt-4 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-brandFaint">
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-right font-display text-sm font-semibold text-brandDark">
            {percent}%
          </span>
        </div>
      </div>
    </MotionLi>
  );
}

export interface PhaseListProps {
  /** 全部阶段（按 phaseIndex 升序） */
  phases: Phase[];
}

function PhaseList({ phases }: PhaseListProps) {
  return (
    <section className="card overflow-hidden">
      <ul className="divide-y divide-brandFaint">
        {phases.map((phase, index) => (
          <PhaseItem key={phase.id} phase={phase} index={index} />
        ))}
      </ul>
    </section>
  );
}

export default PhaseList;
