/**
 * 「看看它怎么工作」的演示面板 —— Agent 工作流的过程态。
 *
 * 演示目标：让评委看到一次学习复盘是**怎么被生成出来的**，而不是只看到一个结果。
 * 所以这里刻意展示中间过程：检索了什么、调用了哪个工具、入参出参是什么。
 *
 * 为什么全部在前端驱动、不走真实 SSE：
 * 这个页面是演示首屏，任何一次网络抖动或 API key 未配置都会变成一次翻车现场。
 * 过程动画是演的，但**里面的数字是真的**（见 `lib/mainframeDemo.ts`），
 * 引用卡片里的文件名也优先取用户真实上传的文档。
 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookOpen,
  Check,
  ChevronDown,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import type { DemoCitation, DemoSnapshot } from '@/lib/mainframeDemo';
import { formatHours } from '@/lib/mainframeDemo';

/** 单步停留时长。太短看不清链路，太长评委会等得不耐烦。 */
const STEP_DURATION = 900;

type StepStatus = 'pending' | 'running' | 'done';

interface WorkflowStep {
  key: string;
  title: string;
  /** 折叠状态下显示的一行摘要 */
  summary: string;
  /** 展开后的明细 */
  detail: string[];
  icon: typeof Search;
}

function buildSteps(snapshot: DemoSnapshot, citations: DemoCitation[]): WorkflowStep[] {
  const phaseLine =
    snapshot.phaseTotal > 0
      ? `阶段进度 ${snapshot.phaseCompleted}/${snapshot.phaseTotal}`
      : `连续打卡 ${snapshot.streakDays} 天`;

  return [
    {
      key: 'retrieve',
      title: '检索知识库',
      summary: `命中 ${citations.length} 个相关片段`,
      icon: Search,
      detail: citations.map(
        (c) => `${c.filename} · 相关度 ${(c.score * 100).toFixed(0)}%`,
      ),
    },
    {
      key: 'tool',
      title: '调用工具',
      summary: 'get_weekly_review',
      icon: Wrench,
      detail: [
        '工具名：get_weekly_review',
        '入参：{ "range": "本周" }',
        `返回：完成率 ${snapshot.completionRate}% · 学习 ${formatHours(snapshot.totalMinutes)} 小时`,
      ],
    },
    {
      key: 'compose',
      title: '生成复盘',
      summary: '汇总 4 个维度',
      icon: Sparkles,
      detail: [
        `完成率 ${snapshot.completionRate}%`,
        `累计学习 ${formatHours(snapshot.totalMinutes)} 小时`,
        `连续打卡 ${snapshot.streakDays} 天`,
        phaseLine,
      ],
    },
    {
      key: 'done',
      title: '完成',
      summary: '本周复盘已生成',
      icon: Check,
      detail: ['结果已写入「本周复盘」，可在该页查看完整报告与各科掌握度明细。'],
    },
  ];
}

export interface WorkflowDemoProps {
  snapshot: DemoSnapshot;
  citations: DemoCitation[];
  onClose: () => void;
}

function WorkflowDemo({ snapshot, citations, onClose }: WorkflowDemoProps) {
  const steps = useMemo(() => buildSteps(snapshot, citations), [snapshot, citations]);
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const finished = cursor >= steps.length;

  useEffect(() => {
    if (finished) return;
    const id = window.setTimeout(() => setCursor((c) => c + 1), STEP_DURATION);
    return () => window.clearTimeout(id);
  }, [cursor, finished]);

  const statusOf = (index: number): StepStatus => {
    if (index < cursor) return 'done';
    if (index === cursor) return 'running';
    return 'pending';
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-4 backdrop-blur-md"
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/12 bg-[#0B0F0D]"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  finished ? 'bg-brand' : 'animate-pulse bg-brand'
                }`}
                aria-hidden="true"
              />
              <span className="text-[11px] tracking-[0.16em] text-white/50">
                AGENT 工作流
              </span>
            </div>
            <h2 className="mt-2 text-[19px] font-medium leading-snug text-white">
              一次学习复盘是怎么生成的
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-white/50">
              {finished ? '链路已完成，下方是这次回答的引用来源' : '正在执行，可点开任意一步看明细'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭演示"
            className="shrink-0 rounded-full p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <ol className="space-y-1.5">
            {steps.map((step, index) => {
              const status = statusOf(index);
              const isOpen = expanded === step.key;
              const Icon = step.icon;
              return (
                <li key={step.key}>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : step.key)}
                    aria-expanded={isOpen}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-2.5 text-left transition-colors ${
                      status === 'pending'
                        ? 'border-white/8 text-white/35'
                        : 'border-white/12 text-white hover:border-white/25'
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                        status === 'done'
                          ? 'border-brand bg-brand text-[#06231A]'
                          : status === 'running'
                            ? 'border-brand text-brand'
                            : 'border-white/20 text-white/35'
                      }`}
                      aria-hidden="true"
                    >
                      {status === 'done' ? (
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                      ) : status === 'running' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Icon className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium">{step.title}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-white/45">
                        {status === 'pending' ? '等待执行' : step.summary}
                      </span>
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-white/40 transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen ? (
                      <motion.ul
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="ml-[42px] mr-2 mt-2 space-y-1.5 border-l border-white/12 pl-4 pb-1">
                          {step.detail.map((line) => (
                            <li
                              key={line}
                              className="text-[12.5px] leading-relaxed text-white/55"
                            >
                              {line}
                            </li>
                          ))}
                        </div>
                      </motion.ul>
                    ) : null}
                  </AnimatePresence>
                </li>
              );
            })}
          </ol>

          <AnimatePresence>
            {finished ? (
              <motion.section
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.32, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                className="mt-4 rounded-2xl border border-white/12 bg-white/[0.03] p-4"
              >
                <div className="flex items-center gap-2 text-white/70">
                  <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="text-[11px] tracking-[0.16em]">引用溯源</span>
                </div>
                <ul className="mt-3 space-y-2.5">
                  {citations.map((c, i) => (
                    <li key={`${c.filename}-${i}`} className="border-l-2 border-brand/60 pl-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-[13px] font-medium text-white">
                          {c.filename}
                        </span>
                        <span className="shrink-0 text-[11px] text-brand">
                          {(c.score * 100).toFixed(0)}%
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[12.5px] text-white/55">
                        {c.snippet}
                      </p>
                    </li>
                  ))}
                </ul>
              </motion.section>
            ) : null}
          </AnimatePresence>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-white/10 px-6 py-3.5">
          <span className="text-[11.5px] text-white/35">
            {finished
              ? snapshot.live
                ? '数据来自你的真实学习记录'
                : '当前为演示数据'
              : `第 ${Math.min(cursor + 1, steps.length)} / ${steps.length} 步`}
          </span>
          <button
            type="button"
            onClick={() => {
              setCursor(0);
              setExpanded(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1.5 text-[12.5px] text-white/70 transition-colors hover:border-white/40 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            重新演示
          </button>
        </footer>
      </motion.div>
    </motion.div>
  );
}

export default WorkflowDemo;
