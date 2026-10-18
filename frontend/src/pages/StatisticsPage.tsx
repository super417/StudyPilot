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
  ArrowRight,
  Bookmark,
  Calendar,
  ClipboardCheck,
  FileText,
  Lightbulb,
} from 'lucide-react';
import PhaseRings from '@/components/PhaseRings';
import type { TabKey } from '@/components/TabNav';
import type { ReinforceOutcome, WeeklyReview } from '@/mocks/types';
import { useAssistantStore, usePlanSessionStore } from '@/store';
import { ApiError } from '@/lib/httpClient';
import { createReinforcePreview } from '@/lib/plansApi';
import { generateReinforceRetest } from '@/lib/practiceApi';
import {
  fetchStatisticsOverview,
  type DailyActivityItem,
  type MasteryDistribution,
  type StatisticsOverview,
  type TopMistakeItem,
} from '@/lib/statisticsApi';
import { fetchLatestWeeklyReview, toWeeklyReview } from '@/lib/weeklyReviewsApi';

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

function BarChart({ items }: { items: DailyActivityItem[] }) {
  const max = Math.max(1, ...items.map((d) => d.count));
  const w = 420;
  const h = 180;
  const padL = 28;
  const padB = 28;
  const padT = 12;
  const padR = 8;
  const innerW = w - padL - padR;
  const innerH = h - padB - padT;
  const barW = innerW / Math.max(items.length, 1);
  const barColor = '#3B82F6';
  const [tip, setTip] = useState<TipState>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const hasData = items.some((d) => d.count > 0);
  if (!hasData) {
    return <p className="py-10 text-center text-sm text-slate-400">暂无数据，继续加油</p>;
  }
  const labelEvery = Math.max(1, Math.ceil(items.length / 6));
  const total = items.reduce((s, d) => s + d.count, 0);

  const onBarMove = (
    event: ReactMouseEvent<SVGRectElement>,
    d: DailyActivityItem,
  ) => {
    const host = event.currentTarget.ownerSVGElement?.parentElement;
    if (!host) return;
    const box = host.getBoundingClientRect();
    const dayLabel = d.date.slice(5); // MM-DD
    setHoverKey(d.date);
    setTip({
      label: dayLabel,
      value: d.count,
      percent: total ? Math.round((100 * d.count) / total) : 0,
      color: barColor,
      unitLabel: '道题',
      text: `${dayLabel}: 完成 ${d.count} 道题`,
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    });
  };

  const clearHover = () => {
    setTip(null);
    setHoverKey(null);
  };

  return (
    <div className="relative w-full">
      <ChartTooltip tip={tip} />
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-auto w-full max-w-full overflow-visible"
        onMouseLeave={clearHover}
      >
        {items.map((d, i) => {
          const hovered = hoverKey === d.date;
          const baseW = barW * 0.7;
          const bw = hovered ? baseW * 1.35 : baseW;
          const bhRaw = (d.count / max) * innerH;
          const bh = Math.max(bhRaw * (hovered ? 1.08 : 1), d.count > 0 ? 2 : 0);
          const x = padL + i * barW + (barW - bw) / 2;
          const y = padT + innerH - bh;
          // 整列透明热区，零作答日也能悬停
          const hitX = padL + i * barW;
          return (
            <g key={d.date}>
              <rect
                x={hitX}
                y={padT}
                width={barW}
                height={innerH}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => onBarMove(e, d)}
                onMouseMove={(e) => onBarMove(e, d)}
              />
              <rect
                x={x}
                y={y}
                width={bw}
                height={bh}
                rx={hovered ? 4 : 2}
                fill={barColor}
                opacity={hovered ? 1 : 0.85}
                style={{
                  pointerEvents: 'none',
                  transition: 'x 0.18s ease-out, y 0.18s ease-out, width 0.18s ease-out, height 0.18s ease-out, opacity 0.18s ease-out',
                  filter: hovered ? 'drop-shadow(0 2px 4px rgba(59,130,246,0.35))' : undefined,
                }}
              />
            </g>
          );
        })}
        {items.map((d, i) =>
          i % labelEvery === 0 || i === items.length - 1 ? (
            <text
              key={`t-${d.date}`}
              x={padL + i * barW + barW / 2}
              y={h - 8}
              textAnchor="middle"
              className="fill-slate-400"
              fontSize={9}
            >
              {d.date.slice(5)}
            </text>
          ) : null,
        )}
        <text x={4} y={padT + 8} className="fill-slate-400" fontSize={9}>
          {max}
        </text>
      </svg>
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
  const [data, setData] = useState<StatisticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const openAssistantWithContext = useAssistantStore((s) => s.openAssistantWithContext);
  const startConversation = useAssistantStore((s) => s.startConversation);

  const lastPlanId = usePlanSessionStore((s) => s.lastPlanId);
  const activePlanId = usePlanSessionStore((s) => s.activePlanId);
  const setPendingAdjustment = usePlanSessionStore((s) => s.setPendingAdjustment);
  const setActivePlanId = usePlanSessionStore((s) => s.setActivePlanId);

  const [review, setReview] = useState<WeeklyReview | null>(null);
  const [reviewEmpty, setReviewEmpty] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reinforceMsg, setReinforceMsg] = useState<string | null>(null);
  const [reinforceBusy, setReinforceBusy] = useState(false);
  const [retestBusyPhaseId, setRetestBusyPhaseId] = useState<string | null>(null);

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
  }, [lastPlanId]);

  // 优先用 overview 接口返回的计划 id（store 无持久化，直进本页时可能为空）
  const planId = data?.activePlanId ?? activePlanId ?? lastPlanId;

  const reinforceOutcomesByPhase = useMemo(() => {
    const map: Record<string, ReinforceOutcome> = {};
    for (const item of review?.reinforceOutcomes ?? []) {
      if (item.phaseId) map[item.phaseId] = item;
    }
    return map;
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
          ? `已生成 ${count} 道重测题，请到习题本作答`
          : '没有生成重测题（可能缺少可检索资料）',
      );
      if (count > 0) onNavigate?.('mistakes');
      await reloadReview();
    } catch (e) {
      setReinforceMsg(e instanceof ApiError ? e.message : '重测出题失败');
    } finally {
      setRetestBusyPhaseId(null);
    }
  };

  const cards = useMemo(() => {
    if (!data) return CARDS.map((c) => ({ ...c, value: 0 }));
    return CARDS.map((c) => ({ ...c, value: data[c.key] }));
  }, [data]);

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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <article
              key={card.key}
              className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:p-5"
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

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-800">触发补强</h2>
            <p className="mt-1 text-sm text-slate-500">
              某阶段完成度明显高于掌握度时，可生成补强任务，重做错题并重读原文。
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
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <article className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-base font-semibold text-slate-800">阶段双环</h2>
          {reviewError ? (
            <div role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {reviewError}
              <button type="button" className="ml-3 underline" onClick={() => void reloadReview()}>
                重试
              </button>
            </div>
          ) : reviewLoading ? (
            <p className="py-10 text-center text-sm text-slate-400">加载阶段双环…</p>
          ) : reviewEmpty || !review ? (
            <p className="py-10 text-center text-sm text-slate-400">
              完成一周学习后，这里会显示各阶段的完成度与掌握度双环。
            </p>
          ) : (
            <PhaseRings
              items={review.masteryDetail}
              reinforceOutcomesByPhase={reinforceOutcomesByPhase}
              onRequestRetest={(phaseId) => void handleRequestRetest(phaseId)}
              retestBusyPhaseId={retestBusyPhaseId}
            />
          )}
        </article>
        <article className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-base font-semibold text-slate-800">近 30 日作答量</h2>
          <BarChart items={data?.dailyActivity ?? []} />
        </article>
        <article className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-base font-semibold text-slate-800">掌握度分布</h2>
          <PieChart
            mastery={data?.masteryDistribution ?? { correct: 0, partial: 0, wrong: 0 }}
          />
        </article>
        <article className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-base font-semibold text-slate-800">高频错题 TOP5</h2>
          <TopMistakesList items={data?.topMistakes ?? []} />
        </article>
      </div>

      <div className="mt-8 flex justify-center">
        <div className="group flex w-full max-w-sm flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center shadow-sm transition-all duration-300 ease-in-out hover:border-solid hover:border-blue-400 hover:shadow-[0_8px_28px_rgba(59,130,246,0.22)]">
          <div className="relative mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-blue-500 shadow-[0_8px_20px_rgba(59,130,246,0.35)] transition-all duration-300 ease-out group-hover:rotate-12 group-hover:rounded-3xl">
            <div className="absolute top-2 left-2 h-0.5 w-2 rotate-45 rounded-full bg-white" />
            <div className="absolute top-2 right-2 h-0.5 w-2 -rotate-45 rounded-full bg-white" />
            <div className="absolute bottom-2 left-2 h-0.5 w-2 -rotate-45 rounded-full bg-white" />
            <div className="absolute bottom-2 right-2 h-0.5 w-2 rotate-45 rounded-full bg-white" />
            <Lightbulb className="h-10 w-10 text-white" aria-hidden="true" />
          </div>
          <h3 className="mb-2 text-xl font-semibold text-slate-800">学习诊断分析</h3>
          <p className="mb-6 text-slate-600">
            基于你的刷题数据，AI 将为你生成个性化学习建议
          </p>
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg bg-blue-500 px-6 py-3 text-white shadow-[0_6px_16px_rgba(59,130,246,0.35)] transition-colors duration-300 hover:bg-blue-600"
            onClick={() =>
              openAssistantWithContext({
                type: 'free',
                hint: '根据我的刷题与掌握度数据，生成一份学习诊断报告',
              })
            }
          >
            生成诊断报告
            <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
          </button>
        </div>
      </div>
    </section>
  );
}

export default StatisticsPage;
