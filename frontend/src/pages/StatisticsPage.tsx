/**
 * 数据统计页：4 指标卡 + 2×2 图表。
 * 布局参考 https://www.408os.cn/statistics （见 docs/direction.md）
 */
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Bookmark,
  Calendar,
  ClipboardCheck,
  FileText,
} from 'lucide-react';
import PhaseRings from '@/components/PhaseRings';
import StackedBars, { type StackedBar } from '@/components/StackedBars';
import StatisticsWeeklyReview from '@/components/StatisticsWeeklyReview';
import StatisticsDiagnosis from '@/components/StatisticsDiagnosis';
import type { TabKey } from '@/components/TabNav';
import type { ReinforceOutcome, WeeklyReview } from '@/mocks/types';
import { useAssistantStore, usePlanSessionStore } from '@/store';
import { ApiError } from '@/lib/httpClient';
import { createReinforcePreview, createRemedyPreview } from '@/lib/plansApi';
import {
  generatePhaseQuiz,
  generateReinforceRetest,
  requestPracticeBoard,
} from '@/lib/practiceApi';
import {
  fetchStatisticsOverview,
  type MasteryDistribution,
  type RoutePhaseItem,
  type StarDayItem,
  type StatisticsOverview,
  type TopMistakeItem,
} from '@/lib/statisticsApi';
import { displayAssistantName, getBasicProfile } from '@/lib/profilePrefs';
import { fetchLatestWeeklyReview, toWeeklyReview } from '@/lib/weeklyReviewsApi';

const DETAIL_PANELS = [
  { key: 'rings', title: '阶段双环' },
  { key: 'activity', title: '近 30 日作答量' },
  { key: 'mastery', title: '掌握度分布' },
  { key: 'mistakes', title: '高频错题 TOP5' },
  { key: 'stars', title: '近 30 日星图' },
  { key: 'route', title: '学习航线' },
  { key: 'feedback', title: '正反馈与顺延' },
] as const;
type DetailPanelKey = (typeof DETAIL_PANELS)[number]['key'];

const MASTERY_COLORS = {
  correct: '#10B981',
  partial: '#F59E0B',
  wrong: '#EF4444',
} as const;

type RingSlice = { key: string; label: string; value: number; color: string };

type TipState = {
  label: string;
  value: number;
  percent: number;
  color: string;
  x: number;
  y: number;
  unitLabel: string;
  /** 有则覆盖默认「label: value unit (percent%)」文案 */
  text?: string;
} | null;

function ChartTooltip({ tip }: { tip: TipState }) {
  if (!tip) return null;
  return (
    <div
      className="pointer-events-none absolute z-20 whitespace-nowrap rounded-md bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-md"
      style={{
        left: tip.x,
        top: tip.y,
        transform: 'translate(-50%, calc(-100% - 10px))',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: tip.color,
      }}
    >
      {tip.text ?? (
        <>
          {tip.label}: {tip.value}
          {tip.unitLabel} ({tip.percent}%)
        </>
      )}
    </div>
  );
}

/** 圆环：进入时旋转展开 + 悬停浮层 */
function AnimatedRing({
  slices,
  unitLabel = '题',
}: {
  slices: RingSlice[];
  unitLabel?: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const [drawn, setDrawn] = useState(false);
  const [tip, setTip] = useState<TipState>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, [slices]);

  if (!total) {
    return <p className="py-10 text-center text-sm text-slate-400">暂无数据</p>;
  }

  const size = 200;
  const stroke = 26;
  const hoverStroke = 34;
  const trackColor = '#D5DEE8';
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;
  const active = slices.filter((s) => s.value > 0);
  // 每段两侧空隙相同：先扣掉 n 份等长 gap，再按比例分剩余弧长
  const n = active.length;
  const gapArc = n > 1 ? Math.max(stroke * 1.15, 22) : 0;
  const usable = Math.max(c - n * gapArc, c * 0.4);

  let offset = 0;
  const segments = active.map((s) => {
    const percent = Math.round((100 * s.value) / total);
    const len = (s.value / total) * usable;
    const startOffset = offset;
    offset += len + gapArc;
    return { ...s, percent, len, startOffset };
  });

  const onMove = (
    event: ReactMouseEvent<SVGCircleElement>,
    seg: (typeof segments)[number],
  ) => {
    const host = event.currentTarget.ownerSVGElement?.parentElement;
    if (!host) return;
    const box = host.getBoundingClientRect();
    setHoverKey(seg.key);
    setTip({
      label: seg.label,
      value: seg.value,
      percent: seg.percent,
      color: seg.color,
      unitLabel,
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    });
  };

  const clearHover = () => {
    setTip(null);
    setHoverKey(null);
  };

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <ChartTooltip tip={tip} />
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="overflow-visible"
          onMouseLeave={clearHover}
        >
          {/* 底轨：整圈背景色，缝隙处露出来 */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={trackColor}
            strokeWidth={stroke}
            strokeLinecap="butt"
          />
          <g
            style={
              {
                transformOrigin: `${cx}px ${cy}px`,
                transform: drawn ? 'rotate(-90deg)' : 'rotate(-270deg)',
                transition: 'transform 0.85s cubic-bezier(0.22, 1, 0.36, 1)',
              } as CSSProperties
            }
          >
            {segments.map((seg) => {
              const activeHover = hoverKey === seg.key;
              return (
                <circle
                  key={seg.key}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={activeHover ? hoverStroke : stroke}
                  strokeLinecap="round"
                  strokeDasharray={drawn ? `${seg.len} ${Math.max(c - seg.len, 0)}` : `0 ${c}`}
                  strokeDashoffset={-seg.startOffset}
                  style={{
                    transition:
                      'stroke-dasharray 0.85s cubic-bezier(0.22, 1, 0.36, 1), stroke-width 0.18s ease-out',
                    cursor: 'pointer',
                    filter: activeHover
                      ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.12))'
                      : undefined,
                  }}
                  onMouseEnter={(e) => onMove(e, seg)}
                  onMouseMove={(e) => onMove(e, seg)}
                >
                  <title>
                    {seg.label}: {seg.value}
                    {unitLabel} ({seg.percent}%)
                  </title>
                </circle>
              );
            })}
          </g>
        </svg>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm text-slate-600">
        {slices.map((s) => {
          const percent = total ? Math.round((100 * s.value) / total) : 0;
          return (
            <li key={s.key} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="truncate">{s.label}</span>
              <span className="ml-auto shrink-0 text-slate-400">
                {s.value}
                {unitLabel} ({percent}%)
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const STAR_FILL: Record<StarDayItem['star'], string> = {
  gold: '#F59E0B',
  blue: '#3B82F6',
  gray: '#94A3B8',
  none: '#475569',
};

function StarFace({ star, size = 28 }: { star: StarDayItem['star']; size?: number }) {
  const fill = STAR_FILL[star];
  const cry = star === 'none';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill={fill} opacity={cry ? 0.55 : 0.95} />
      <circle cx="11" cy="13" r="1.6" fill="#fff" />
      <circle cx="21" cy="13" r="1.6" fill="#fff" />
      {cry ? (
        <path d="M11 22c2-2 8-2 10 0" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      ) : (
        <path d="M11 20c2 2.5 8 2.5 10 0" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      )}
    </svg>
  );
}

function StarMap({ items }: { items: StarDayItem[] }) {
  const [tip, setTip] = useState<TipState>(null);
  const hasData = items.some((d) => d.answered > 0);
  if (!hasData) {
    return <p className="py-10 text-center text-sm text-slate-400">近 30 天还没有掌握度证据</p>;
  }

  return (
    <div className="relative w-full" onMouseLeave={() => setTip(null)}>
      <ChartTooltip tip={tip} />
      <div className="mx-auto grid max-w-xl grid-cols-10 gap-1.5">
        {items.map((d) => {
          const label = d.date.slice(5);
          const text =
            d.star === 'none'
              ? `${label}：这天没有作答`
              : `${label}：${d.answered} 道 · 正确率 ${d.accuracy}%`;
          return (
            <button
              key={d.date}
              type="button"
              title={text}
              className="flex items-center justify-center rounded-md p-0.5 hover:bg-slate-50"
              onMouseEnter={(e) => {
                const host = e.currentTarget.parentElement?.parentElement;
                if (!host) return;
                const box = host.getBoundingClientRect();
                setTip({
                  label,
                  value: d.answered,
                  percent: d.accuracy ?? 0,
                  color: STAR_FILL[d.star],
                  unitLabel: '道',
                  text,
                  x: e.clientX - box.left,
                  y: e.clientY - box.top,
                });
              }}
              onMouseMove={(e) => {
                const host = e.currentTarget.parentElement?.parentElement;
                if (!host) return;
                const box = host.getBoundingClientRect();
                setTip((prev) =>
                  prev
                    ? { ...prev, x: e.clientX - box.left, y: e.clientY - box.top }
                    : prev,
                );
              }}
            >
              <StarFace star={d.star} size={28} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function buildFeedbackLines(data: StatisticsOverview): string[] {
  const lines: string[] = [];
  const done = data.todayTasksDone ?? 0;
  const total = data.todayTasksTotal ?? 0;
  if (total > 0) {
    if (done === total) lines.push(`今天 ${total} 项任务全部完成`);
    else lines.push(`今天已完成 ${done}/${total} 项任务`);
  }

  const withEvidence = (data.stars ?? []).filter((d) => d.accuracy != null);
  if (withEvidence.length >= 3) {
    const last3 = withEvidence.slice(-3);
    const first = last3[0].accuracy as number;
    const last = last3[last3.length - 1].accuracy as number;
    if (first !== last) {
      lines.push(`这三天正确率从 ${first}% 到 ${last}%`);
    }
  }

  const finished = (data.route ?? []).filter((p) => p.progress === 100);
  if (finished.length > 0) {
    const names = finished.map((p) => p.name).join('、');
    lines.push(`${names}已完成`);
  }
  return lines;
}

function RouteTrack({
  items,
  busyPhaseId,
  onQuiz,
  message,
}: {
  items: RoutePhaseItem[];
  busyPhaseId: string | null;
  onQuiz: (phaseId: string) => void;
  message: string | null;
}) {
  if (items.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-400">还没有学习规划阶段</p>;
  }
  return (
    <div className="space-y-3">
      <ol className="flex flex-wrap gap-3">
        {items.map((phase) => {
          const done = phase.progress === 100;
          const canQuiz = done;
          return (
            <li
              key={phase.phaseId}
              className={`min-w-[9.5rem] flex-1 rounded-xl border p-3 ${
                phase.isCurrent
                  ? 'border-blue-400 bg-blue-50'
                  : done
                    ? 'border-emerald-200 bg-emerald-50/60'
                    : 'border-slate-200 bg-slate-50'
              }`}
            >
              <p className="text-sm font-semibold text-slate-800">
                {phase.index}. {phase.name}
              </p>
              <p className="mt-1 text-xs text-slate-500">进度 {phase.progress}%</p>
              <button
                type="button"
                disabled={!canQuiz || busyPhaseId === phase.phaseId}
                title={canQuiz ? '开始该阶段测验' : '该阶段完成后才能测验'}
                onClick={() => onQuiz(phase.phaseId)}
                className="mt-2 w-full rounded-lg bg-slate-800 px-2 py-1.5 text-xs text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {busyPhaseId === phase.phaseId ? '出题中…' : '开始测验'}
              </button>
            </li>
          );
        })}
      </ol>
      {message ? <p className="text-sm text-dangerText">{message}</p> : null}
    </div>
  );
}

function FeedbackAndRemedy({
  data,
  planId,
  onRemedy,
  remedyBusy,
  remedyMsg,
}: {
  data: StatisticsOverview;
  planId: string | null;
  onRemedy: () => void;
  remedyBusy: boolean;
  remedyMsg: string | null;
}) {
  const lines = buildFeedbackLines(data);
  const overdue = data.overdueCount ?? 0;
  const assistantLabel = displayAssistantName(getBasicProfile().assistantName);
  return (
    <div className="space-y-4">
      {lines.length > 0 ? (
        <ul className="space-y-1.5 text-sm text-slate-700">
          {lines.map((line) => (
            <li key={line}>· {line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">暂无可用的正反馈（需要真实完成或掌握度证据）</p>
      )}
      {overdue > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>
            你有 {overdue} 项任务未完成，{assistantLabel}建议顺延到明天，确认后即可生效
          </p>
          <button
            type="button"
            disabled={!planId || remedyBusy}
            onClick={onRemedy}
            className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
          >
            {remedyBusy ? '生成预览中…' : '生成顺延预览'}
          </button>
          {remedyMsg ? <p className="mt-2 text-xs">{remedyMsg}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function PieChart({ mastery }: { mastery: MasteryDistribution }) {
  const slices: RingSlice[] = [
    { key: 'correct', label: '已掌握', value: mastery.correct, color: MASTERY_COLORS.correct },
    { key: 'partial', label: '基本掌握', value: mastery.partial, color: MASTERY_COLORS.partial },
    { key: 'wrong', label: '未掌握', value: mastery.wrong, color: MASTERY_COLORS.wrong },
  ];
  return <AnimatedRing slices={slices} unitLabel="题" />;
}

function TopMistakesList({ items }: { items: TopMistakeItem[] }) {
  if (!items.length) {
    return <p className="py-10 text-center text-sm text-slate-400">暂无错题统计，继续加油</p>;
  }
  return (
    <ol className="space-y-3">
      {items.map((item, i) => (
        <li
          key={item.name}
          className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2 text-sm last:border-0"
        >
          <span className="min-w-0 truncate text-slate-700">
            <span className="mr-2 font-semibold text-slate-400">{i + 1}.</span>
            {item.name}
          </span>
          <span className="shrink-0 text-slate-500">{item.count} 次</span>
        </li>
      ))}
    </ol>
  );
}

const CARDS = [
  {
    key: 'totalAnswered' as const,
    label: '累计作答',
    sub: '已判分习题',
    icon: ClipboardCheck,
    iconBg: 'bg-blue-100 text-blue-600',
  },
  {
    key: 'studyDays' as const,
    label: '学习天数',
    sub: '有打卡的日期',
    icon: Calendar,
    iconBg: 'bg-emerald-100 text-emerald-600',
  },
  {
    key: 'uploadedDocs' as const,
    label: '上传资料',
    sub: '知识库文档',
    icon: FileText,
    iconBg: 'bg-orange-100 text-orange-600',
  },
  {
    key: 'mistakeCount' as const,
    label: '错题收录',
    sub: '错题本条目',
    icon: Bookmark,
    iconBg: 'bg-cyan-100 text-cyan-600',
  },
];

export interface StatisticsPageProps {
  onNavigate?: (tab: TabKey) => void;
}

function StatisticsPage({ onNavigate }: StatisticsPageProps = {}) {
  const [activePanel, setActivePanel] = useState<DetailPanelKey | null>(null);
  const [data, setData] = useState<StatisticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const openAssistantWithContext = useAssistantStore((s) => s.openAssistantWithContext);
  const startConversation = useAssistantStore((s) => s.startConversation);

  const lastPlanId = usePlanSessionStore((s) => s.lastPlanId);
  const activePlanId = usePlanSessionStore((s) => s.activePlanId);
  const planDataEpoch = usePlanSessionStore((s) => s.planDataEpoch);
  const setPendingAdjustment = usePlanSessionStore((s) => s.setPendingAdjustment);
  const setActivePlanId = usePlanSessionStore((s) => s.setActivePlanId);

  const [review, setReview] = useState<WeeklyReview | null>(null);
  const [reviewEmpty, setReviewEmpty] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reinforceMsg, setReinforceMsg] = useState<string | null>(null);
  const [reinforceBusy, setReinforceBusy] = useState(false);
  const [retestBusyPhaseId, setRetestBusyPhaseId] = useState<string | null>(null);
  const [quizBusyPhaseId, setQuizBusyPhaseId] = useState<string | null>(null);
  const [quizMsg, setQuizMsg] = useState<string | null>(null);
  const [remedyBusy, setRemedyBusy] = useState(false);
  const [remedyMsg, setRemedyMsg] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void fetchStatisticsOverview()
      .then((res) => setData(res))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : '统计加载失败');
        setData(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const reloadReview = async () => {
    setReviewLoading(true);
    setReviewError(null);
    try {
      const weeklyRes = await fetchLatestWeeklyReview();
      if (weeklyRes.empty || !weeklyRes.review) {
        setReview(null);
        setReviewEmpty(true);
      } else {
        setReview(toWeeklyReview(weeklyRes.review));
        setReviewEmpty(false);
      }
    } catch (e) {
      setReviewError(e instanceof ApiError ? e.message : '周报加载失败');
      setReview(null);
      setReviewEmpty(false);
    } finally {
      setReviewLoading(false);
    }
  };

  useEffect(() => {
    void reloadReview();
    // 规划生成后阶段数会变，双环依赖周报 masteryDetail。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPlanId, planDataEpoch]);

  // 优先用 overview 接口返回的计划 id（store 无持久化，直进本页时可能为空）
  const planId = data?.activePlanId ?? activePlanId ?? lastPlanId;

  const reinforceOutcomesByPhase = useMemo(() => {
    const map: Record<string, ReinforceOutcome> = {};
    for (const item of review?.reinforceOutcomes ?? []) {
      if (item.phaseId) map[item.phaseId] = item;
    }
    return map;
  }, [review]);

  /** 已有补强任务的阶段：重测入口挂在「触发补强」卡，不挂双环 */
  const retestPhases = useMemo(() => {
    const details = review?.masteryDetail ?? [];
    return (review?.reinforceOutcomes ?? [])
      .filter((item): item is ReinforceOutcome & { phaseId: string } => Boolean(item.phaseId))
      .map((item) => ({
        phaseId: item.phaseId,
        name:
          details.find((d) => d.phaseId === item.phaseId)?.subject ?? '已补强阶段',
        pendingRetest: item.after.evidenceCount === 0,
      }));
  }, [review]);

  const handleRequestReinforce = async () => {
    if (!planId || reinforceBusy) return;
    setReinforceBusy(true);
    setReinforceMsg(null);
    try {
      const preview = await createReinforcePreview(planId);
      if (planId !== 'derived-latest') setActivePlanId(planId);
      setPendingAdjustment(preview);
      // 新开会话再看预览，避免把无关聊天记录叠在补强预览上面
      useAssistantStore.setState({ open: true, composerDraft: '' });
      await startConversation({ type: 'free', hint: '查看补强预览' });
      setReinforceMsg(
        preview.validation?.ok === false
          ? preview.decisionSummary || '没有可生成的补强任务'
          : '已生成补强预览，确认前不会改正式计划',
      );
    } catch (e) {
      setReinforceMsg(e instanceof ApiError ? e.message : '生成补强预览失败');
    } finally {
      setReinforceBusy(false);
    }
  };

  const handleRequestRetest = async (phaseId: string) => {
    if (!phaseId || retestBusyPhaseId) return;
    setRetestBusyPhaseId(phaseId);
    setReinforceMsg(null);
    try {
      const res = await generateReinforceRetest(phaseId);
      const count = res.questions?.length ?? 0;
      setReinforceMsg(
        count > 0
          ? `已生成 ${count} 道重测题，请到习题本「今日练习」作答`
          : '没有生成重测题（可能缺少可检索资料）',
      );
      if (count > 0) {
        requestPracticeBoard('today');
        onNavigate?.('mistakes');
      }
      await reloadReview();
    } catch (e) {
      setReinforceMsg(e instanceof ApiError ? e.message : '重测出题失败');
    } finally {
      setRetestBusyPhaseId(null);
    }
  };

  const handlePhaseQuiz = async (phaseId: string) => {
    if (!phaseId || quizBusyPhaseId) return;
    setQuizBusyPhaseId(phaseId);
    setQuizMsg(null);
    try {
      const res = await generatePhaseQuiz(phaseId);
      const count = res.questions?.length ?? 0;
      if (count > 0) {
        requestPracticeBoard('today');
        onNavigate?.('mistakes');
        setQuizMsg(`已生成 ${count} 道阶段测验题，请到习题本「今日练习」作答`);
      } else {
        setQuizMsg('没有生成测验题（可能缺少可检索资料）');
      }
    } catch (e) {
      setQuizMsg(e instanceof ApiError ? e.message : '阶段测验出题失败');
    } finally {
      setQuizBusyPhaseId(null);
    }
  };

  const handleRemedyPreview = async () => {
    if (!planId || remedyBusy) return;
    setRemedyBusy(true);
    setRemedyMsg(null);
    try {
      const preview = await createRemedyPreview(planId);
      if (planId !== 'derived-latest') setActivePlanId(planId);
      setPendingAdjustment(preview);
      openAssistantWithContext({ type: 'free', hint: '查看顺延预览' });
      setRemedyMsg('已生成顺延预览，确认前不会改正式计划');
    } catch (e) {
      setRemedyMsg(e instanceof ApiError ? e.message : '没有可安排的待补任务');
    } finally {
      setRemedyBusy(false);
    }
  };

  const cards = useMemo(() => {
    if (!data) return CARDS.map((c) => ({ ...c, value: 0 }));
    return CARDS.map((c) => ({ ...c, value: data[c.key] }));
  }, [data]);

  /**
   * 「近 30 日作答量」→ 堆叠柱。
   *
   * 柱子上方按掌握度结果拆三段（已掌握 / 基本掌握 / 未掌握），三段之和就是
   * 当日作答量，和右侧「掌握度分布」环图同一套色；基线下方那根是**独立指标**
   * ——当天新收录的错题数，对应原版「被升级的少数」。
   *
   * 不把「未掌握」放到基线下方：那会让上下两段各用一套比例尺，4 条已掌握
   * 画得比 6 条未掌握还高，等于把数据说反了。
   */
  const activityBars = useMemo<StackedBar[]>(
    () =>
      (data?.dailyActivity ?? []).map((d) => ({
        label: d.date.slice(5), // MM-DD
        short: d.date.slice(5),
        segs: [
          { label: '已掌握', value: d.correct ?? 0 },
          { label: '基本掌握', value: d.partial ?? 0 },
          { label: '未掌握', value: d.wrong ?? 0 },
        ],
        esc: d.mistakes ?? 0,
      })),
    [data],
  );

  const hasActivity = activityBars.some(
    (b) => b.esc > 0 || b.segs.some((s) => s.value > 0),
  );

  const panelContent = (key: DetailPanelKey) => {
    switch (key) {
      case 'rings':
        return reviewError ? (
          <div role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {reviewError}
            <button type="button" className="ml-3 underline" onClick={() => void reloadReview()}>重试</button>
          </div>
        ) : reviewLoading ? (
          <p className="py-10 text-center text-sm text-slate-400">加载阶段双环…</p>
        ) : reviewEmpty || !review ? (
          <p className="py-10 text-center text-sm text-slate-400">完成一周学习后，这里会显示各阶段的完成度与掌握度双环。</p>
        ) : (
          <PhaseRings items={review.masteryDetail} reinforceOutcomesByPhase={reinforceOutcomesByPhase} />
        );
      case 'activity':
        return hasActivity ? (
          <StackedBars bars={activityBars} unit="道" escLabel="新增错题" gap={4} />
        ) : (
          <p className="py-10 text-center text-sm text-slate-400">暂无数据，继续加油</p>
        );
      case 'mastery':
        return <PieChart mastery={data?.masteryDistribution ?? { correct: 0, partial: 0, wrong: 0 }} />;
      case 'mistakes':
        return <TopMistakesList items={data?.topMistakes ?? []} />;
      case 'stars':
        return <StarMap items={data?.stars ?? []} />;
      case 'route':
        return <RouteTrack items={data?.route ?? []} busyPhaseId={quizBusyPhaseId} onQuiz={(id) => void handlePhaseQuiz(id)} message={quizMsg} />;
      case 'feedback':
        return data ? (
          <FeedbackAndRemedy data={data} planId={planId} onRemedy={() => void handleRemedyPreview()} remedyBusy={remedyBusy} remedyMsg={remedyMsg} />
        ) : (
          <p className="py-6 text-center text-sm text-slate-400">加载统计后显示</p>
        );
    }
  };

  const openPanelFromCard = (key: DetailPanelKey, event: ReactMouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    setActivePanel(key);
  };

  if (loading) {
    return <p className="text-sm text-brandDark/60">正在加载数据统计…</p>;
  }
  if (error) {
    return <p className="text-sm text-dangerText">{error}</p>;
  }

  return (
    <section className="space-y-6">
      <header>
        <p className="text-xs font-semibold tracking-wide text-brand/80">STATISTICS</p>
        <h1 className="mt-1 text-2xl font-semibold text-brandDark">数据统计</h1>
        <p className="mt-1 text-sm text-slate-500">用作答、打卡与掌握度证据，看清学习投入与薄弱环节。</p>
      </header>

      <StatisticsWeeklyReview
        review={review}
        empty={reviewEmpty}
        loading={reviewLoading}
        error={reviewError}
        onRetry={() => void reloadReview()}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <article
              key={card.key}
              className="pressable-card flex items-center gap-3 squircle-card bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:p-5"
            >
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${card.iconBg}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-semibold tabular-nums text-slate-800">{card.value}</p>
                <p className="text-sm font-medium text-slate-700">{card.label}</p>
                <p className="text-xs text-slate-400">{card.sub}</p>
              </div>
            </article>
          );
        })}
      </div>

      <section className="pressable-card squircle-card bg-white p-6 shadow-sm ring-1 ring-slate-100">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-800">触发补强</h2>
            <p className="mt-1 text-sm text-slate-500">
              完成度明显高于掌握度时生成补强任务；确认后在此重测，再到下方双环看掌握度变化。
            </p>
          </div>
          <button
            type="button"
            disabled={!planId || reinforceBusy}
            onClick={() => void handleRequestReinforce()}
            className="shrink-0 rounded-xl bg-purple px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-purple/90 disabled:opacity-50"
          >
            {reinforceBusy ? '正在生成补强预览…' : '生成补强任务'}
          </button>
        </div>
        {!planId ? (
          <p className="mt-2 text-xs text-slate-400">还没有学习计划，请先在总览页生成规划</p>
        ) : null}
        {reinforceMsg ? (
          <p className="mt-3 text-sm text-gray-500" role="status">
            {reinforceMsg}
          </p>
        ) : null}
        {retestPhases.length > 0 ? (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="text-sm font-medium text-slate-700">补强后重测</p>
            <p className="mt-1 text-xs text-slate-400">
              只为已确认补强的阶段出题；做完后看下方「阶段双环」的补强前/后变化。
            </p>
            <ul className="mt-3 space-y-2">
              {retestPhases.map((phase) => (
                <li
                  key={phase.phaseId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{phase.name}</p>
                    <p className="text-xs text-slate-400">
                      {phase.pendingRetest ? '尚未重测' : '已有重测作答'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(retestBusyPhaseId)}
                    onClick={() => void handleRequestRetest(phase.phaseId)}
                    className="shrink-0 rounded-lg bg-purple px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple/90 disabled:opacity-50"
                  >
                    {retestBusyPhaseId === phase.phaseId ? '正在出重测题…' : '重测'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className={activePanel ? 'space-y-4' : 'grid grid-cols-1 gap-6 md:grid-cols-2'}>
        {(activePanel ? DETAIL_PANELS.filter((panel) => panel.key === activePanel) : DETAIL_PANELS).map((panel) => (
          <article
            key={panel.key}
            onClick={(event) => openPanelFromCard(panel.key, event)}
            className={`statistics-panel-glass pressable-card p-6 ${activePanel ? 'min-h-80' : 'cursor-pointer'} ${!activePanel && ['stars', 'route', 'feedback'].includes(panel.key) ? 'md:col-span-2' : ''}`}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-800">
                {activePanel ? panel.title : (
                  <button type="button" className="rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" onClick={() => setActivePanel(panel.key)} aria-label={`展开${panel.title}`}>
                    {panel.title}
                  </button>
                )}
              </h2>
              {activePanel ? <button type="button" className="pressable-card rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50" onClick={() => setActivePanel(null)}>收起详情</button> : null}
            </div>
            {panelContent(panel.key)}
          </article>
        ))}
        {activePanel ? (
          <nav className="flex gap-3 overflow-x-auto pb-2" aria-label="统计模块缩略条">
            {DETAIL_PANELS.filter((panel) => panel.key !== activePanel).map((panel) => (
              <button key={panel.key} type="button" onClick={() => setActivePanel(panel.key)} className="pressable-card min-w-36 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-4 text-left text-sm font-medium text-slate-700 shadow-sm hover:border-brand hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                {panel.title}
              </button>
            ))}
          </nav>
        ) : null}
      </div>

      <StatisticsDiagnosis />
    </section>
  );
}

export default StatisticsPage;
