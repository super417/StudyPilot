import { useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion';
import type { Plan } from '@/mocks/types';
import { computeDayNumber, computeElapsedPercent, MS_PER_DAY } from '@/lib/goalProgress';

/**
 * 演示用的稳定「今天」。
 *
 * mock 规划的 startDate 尚在未来，若用真实 new Date() 环形值会 clamp 到 0；
 * 这里默认取 startDate 之后第 8 天，让静态环形能展示一个非零小百分比。
 * 生产接入真实数据后由调用方传入真实 today（默认可改为 new Date()）。
 */
function defaultMockToday(startDate: string): Date {
  return new Date(new Date(startDate).getTime() + 7 * MS_PER_DAY);
}

export interface GoalCardProps {
  /** 学习规划数据 */
  plan: Plan;
  /** 参考「今天」，默认取演示用稳定日期，便于计算与测试 */
  today?: string | Date;
}

/** 环形进度的几何参数 */
const RING_SIZE = 132;
const RING_STROKE = 12;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** 入场 spring 配置（柔和有回弹，不过冲太多，需求 18.11）。 */
const SPRING_CONFIG = { stiffness: 120, damping: 18, mass: 1 } as const;

/** 通过 motion.create() 生成的动画圆弧元素。 */
const MotionCircle = motion.create('circle');

/**
 * GoalCard — 总览页左侧主卡片（需求 4.1 / 12.7 / 18.11）
 *
 * 展示当前目标大标题（Hero 渐变文字）、副标题，以及「备考时间流逝百分比」环形进度。
 *
 * 动效（任务 26 · 需求 18.11）：主卡片入场时，圆心百分比数字与环形进度以 spring
 * 弹性动画从 0 呈现到「目标值」。目标值 = 现有静态计算结果（percent），spring 只
 * 负责入场呈现，稳定后停在正确值，视觉与静态版本一致（需求 18.29 增强不破坏）。
 * 使用 useSpring 驱动一个 0→percent 的进度值，再用 useTransform 派生出环形
 * strokeDashoffset 与百分比文案；两者同源，保证数字与环形始终一致。
 */
function GoalCard({ plan, today }: GoalCardProps) {
  const effectiveToday = today ?? defaultMockToday(plan.startDate);
  const percent = computeElapsedPercent(plan.startDate, plan.goalDate, effectiveToday);
  const dayNumber = computeDayNumber(plan.startDate, effectiveToday);
  const percentLabel = percent.toFixed(1);

  const prefersReducedMotion = useReducedMotion();

  // 进度动画源：0 → percent 的 spring 弹性入场。
  const progress = useMotionValue(0);
  const springProgress = useSpring(progress, SPRING_CONFIG);

  // 环形已流逝弧长（从顶部起、顺时针）随 spring 进度变化，稳定后 = 静态 dashOffset。
  const dashOffset = useTransform(
    springProgress,
    (value) => RING_CIRCUMFERENCE * (1 - value / 100),
  );
  // 圆心百分比数字随同源 spring 变化，保留一位小数，稳定后 = percentLabel。
  const displayPercent = useTransform(springProgress, (value) => `${value.toFixed(1)}%`);

  useEffect(() => {
    // 尊重「减少动效」偏好：直接落到目标值，不做弹性入场。
    if (prefersReducedMotion) {
      progress.jump(percent);
      return;
    }
    progress.set(percent);
  }, [percent, prefersReducedMotion, progress]);

  return (
    <section className="card p-8">
      <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        {/* 左侧：标签行 + 目标标题 + 副标题 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
              LEARNING CYCLE · postgrad-2028
            </span>
            <span className="shrink-0 rounded-full bg-brandLight px-3 py-1 text-xs font-medium text-brandDark">
              第 {dayNumber} 天
            </span>
          </div>

          <p className="mt-6 text-sm text-gray-500">当前目标</p>
          <h2
            className="text-gradient mt-1 font-black leading-none tracking-tight"
            style={{ fontSize: 'clamp(2.5rem, 6vw, 96px)' }}
          >
            {plan.goalName}
          </h2>
          <p className="mt-3 text-base text-gray-500">{plan.subtitle}</p>
        </div>

        {/* 右侧：环形进度（备考时间流逝百分比），spring 弹性入场 */}
        <div className="flex shrink-0 items-center justify-center">
          <div
            className="relative"
            style={{ width: RING_SIZE, height: RING_SIZE }}
            role="img"
            aria-label={`备考时间流逝 ${percentLabel}%`}
          >
            <svg
              width={RING_SIZE}
              height={RING_SIZE}
              viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
            >
              {/* 轨道：极浅绿 */}
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke="#D1FAE5"
                strokeWidth={RING_STROKE}
              />
              {/* 进度弧：主色绿，从 12 点方向顺时针，strokeDashoffset 由 spring 驱动 */}
              <MotionCircle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke="#10B981"
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                style={{ strokeDashoffset: dashOffset }}
                transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
              />
            </svg>
            {/* 圆心文字：百分比数字随 spring 弹入，稳定后停在正确值 */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <motion.span className="font-display text-3xl font-bold text-brandDark">
                {displayPercent}
              </motion.span>
              <span className="mt-0.5 text-xs text-gray-400">备考时间</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default GoalCard;
