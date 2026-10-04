import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { Phase } from '@/mocks/types';
import { FADE_IN_EASE } from './motion/utils';

export interface PhaseEdit {
  name: string;
  startDate: string;
  endDate: string;
}

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
  editing?: boolean;
  saving?: boolean;
  onStartEdit?: () => void;
  onCancel?: () => void;
  onSave?: (edit: PhaseEdit) => void;
}

/** 把 clamp(...) 的进度值约束到 0-100，避免异常数据溢出进度条。 */
function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function PhaseItem({
  phase,
  index,
  editing = false,
  saving = false,
  onStartEdit,
  onCancel,
  onSave,
}: PhaseItemProps) {
  const percent = clampPercent(phase.progressPercent);
  const [name, setName] = useState(phase.name);
  const [startDate, setStartDate] = useState(phase.startDate);
  const [endDate, setEndDate] = useState(phase.endDate);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setName(phase.name);
    setStartDate(phase.startDate);
    setEndDate(phase.endDate);
    setFormError(null);
  }, [editing, phase.name, phase.startDate, phase.endDate]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('阶段名称不能为空');
      return;
    }
    if (!startDate || !endDate || endDate < startDate) {
      setFormError('结束日期不能早于开始日期');
      return;
    }
    setFormError(null);
    onSave?.({ name: trimmed, startDate, endDate });
  };

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
      whileHover={
        editing
          ? undefined
          : {
              x: 10,
              boxShadow: '0 18px 40px -12px rgba(16, 87, 60, 0.35)',
              transition: { duration: 0.25, ease: FADE_IN_EASE },
            }
      }
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
          {onStartEdit && !editing ? (
            <button
              type="button"
              onClick={onStartEdit}
              className="shrink-0 rounded-full bg-white/80 px-3 py-0.5 text-xs font-medium text-brandDark ring-1 ring-brand/30 hover:bg-white"
            >
              调整
            </button>
          ) : null}
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

        {editing ? (
          <form
            className="mt-3 space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label className="block text-xs text-gray-500">
              阶段名称
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full rounded-xl border border-brandFaint bg-white px-3 py-2 text-sm text-brandDark"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-gray-500">
                开始
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-brandFaint bg-white px-3 py-2 text-sm text-brandDark"
                />
              </label>
              <label className="block text-xs text-gray-500">
                结束
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-brandFaint bg-white px-3 py-2 text-sm text-brandDark"
                />
              </label>
            </div>
            {formError ? <p className="text-xs text-dangerText">{formError}</p> : null}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-brandDark px-4 py-1.5 text-xs font-medium text-white disabled:opacity-60"
              >
                {saving ? '保存中…' : '保存这一阶段'}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={onCancel}
                className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-brandDark"
              >
                取消
              </button>
            </div>
          </form>
        ) : (
          <p className="mt-1 text-sm text-gray-500">
            {phase.startDate} ~ {phase.endDate}
          </p>
        )}

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
  /** 保存一张卡片；只应改这一阶段。 */
  onSavePhase?: (phaseId: string, edit: PhaseEdit) => Promise<void>;
}

function PhaseList({ phases, onSavePhase }: PhaseListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const save = async (phaseId: string, edit: PhaseEdit) => {
    if (!onSavePhase || savingId) return;
    setSavingId(phaseId);
    try {
      await onSavePhase(phaseId, edit);
      setEditingId(null);
    } catch {
      // 失败提示由页面写入；表单保持打开。
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="card overflow-hidden">
      <ul className="divide-y divide-brandFaint">
        {phases.map((phase, index) => (
          <PhaseItem
            key={phase.id}
            phase={phase}
            index={index}
            editing={editingId === phase.id}
            saving={savingId === phase.id}
            onStartEdit={onSavePhase ? () => setEditingId(phase.id) : undefined}
            onCancel={() => setEditingId(null)}
            onSave={(edit) => void save(phase.id, edit)}
          />
        ))}
      </ul>
    </section>
  );
}

export default PhaseList;
