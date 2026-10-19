import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { FruitGlyph, LeafMark, SproutAvatar, StarCrown } from '@/components/journey/glyphs';
import {
  contentHeight,
  layoutDays,
  primaryTag,
  scrollTopForToday,
  vinePath,
  visibleIndices,
  wrapPoints,
  type NodePoint,
} from '@/journey/layout';
import type { JourneyDay, JourneyPhase } from '@/journey/types';

const TAG_LABEL = { boss: '阶段 Boss', reinforce: '补强', carried: '顺延' } as const;
const TAG_COLOR = { boss: '#8b5cf6', reinforce: '#3b82f6', carried: '#f59e0b' } as const;

export interface VineMapProps {
  days: JourneyDay[];
  phases: JourneyPhase[];
  today: string;
  goalName: string;
  compact: boolean;
  onSelect: (day: JourneyDay) => void;
  onBoss: (day: JourneyDay) => void;
  onNeed?: (date: string) => void;
  onBlank?: () => void;
}

function curvePoint(from: { x: number; y: number }, to: { x: number; y: number }, t: number) {
  const mid = (from.y + to.y) / 2;
  const u = 1 - t;
  const x = u * u * u * from.x + 3 * u * u * t * from.x + 3 * u * t * t * to.x + t * t * t * to.x;
  const y = u * u * u * from.y + 3 * u * u * t * mid + 3 * u * t * t * mid + t * t * t * to.y;
  const ahead = Math.min(1, t + 0.08);
  const ua = 1 - ahead;
  const x2 = ua * ua * ua * from.x + 3 * ua * ua * ahead * from.x + 3 * ua * ahead * ahead * to.x + ahead * ahead * ahead * to.x;
  const y2 = ua * ua * ua * from.y + 3 * ua * ua * ahead * mid + 3 * ua * ahead * ahead * mid + ahead * ahead * ahead * to.y;
  return { x, y, angle: (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI };
}

function fruitSize(day: JourneyDay): number {
  if (day.state === 'future' || day.loaded === false) return 46;
  if (day.state === 'empty') return 40;
  const base = day.stars === 4 ? 72 : day.stars === 3 ? 64 : day.stars === 2 ? 56 : 48;
  return day.state === 'today' ? base + 14 : base;
}

function VineStrand({
  points,
  side,
  width,
  compact,
}: {
  points: NodePoint[];
  side: Array<{ x: number; y: number }>;
  width: number;
  compact: boolean;
}) {
  const gid = useId();
  const main = vinePath(points);
  const wrap = vinePath(side);
  const y0 = Math.min(points[0].y, points[points.length - 1].y) - 48;
  const y1 = Math.max(points[0].y, points[points.length - 1].y) + 48;
  return (
    <svg className="pointer-events-none absolute left-0" style={{ top: y0, width: '100%', height: y1 - y0 }} viewBox={`0 ${y0} ${width} ${y1 - y0}`}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#b6f27a" />
          <stop offset="45%" stopColor="#3cb85a" />
          <stop offset="100%" stopColor="#1f8a3c" />
        </linearGradient>
      </defs>
      <path d={main} stroke="#146b32" strokeWidth={compact ? 26 : 34} fill="none" strokeLinecap="round" />
      <path d={main} stroke={`url(#${gid})`} strokeWidth={compact ? 18 : 24} fill="none" strokeLinecap="round" />
      <path d={main} stroke="white" strokeWidth="5" fill="none" strokeLinecap="round" opacity="0.38" transform="translate(-2 -3)" />
      <path d={wrap} stroke="#7ed957" strokeWidth={compact ? 8 : 11} fill="none" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

export default function VineMap({ days, phases, today, goalName, compact, onSelect, onBoss, onNeed, onBlank }: VineMapProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [viewport, setViewport] = useState(640);
  const [scrollTop, setScrollTop] = useState<number | null>(null);
  const [showReturn, setShowReturn] = useState(false);
  const positioned = useRef(false);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return undefined;
    const measure = () => {
      setWidth(node.clientWidth);
      setViewport(node.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const dates = useMemo(() => days.map((day) => day.date), [days]);
  const points = useMemo(() => layoutDays(dates, width, compact), [dates, width, compact]);
  const height = contentHeight(days.length, compact);
  const phaseStart = useMemo(() => new Map(phases.map((phase) => [phase.startDate, phase.name])), [phases]);
  const todayIndex = days.findIndex((day) => day.date === today);
  const anchor = scrollTop ?? Math.max(0, (points[todayIndex]?.y ?? 0) - viewport * 0.6);
  const visible = useMemo(
    () => new Set(visibleIndices(points.map((point) => point.y), anchor, viewport)),
    [anchor, points, viewport],
  );
  const segments = useMemo(() => {
    const chunks: NodePoint[][] = [];
    for (let index = 0; index < points.length - 1; index += 7) {
      chunks.push(points.slice(index, Math.min(points.length, index + 8)));
    }
    return chunks.filter((chunk) => chunk.some((point) => visible.has(point.index)));
  }, [points, visible]);

  useEffect(() => {
    const node = scroller.current;
    if (!node || positioned.current || todayIndex < 0 || width < 100) return;
    const maxScroll = Math.max(0, height - node.clientHeight);
    node.scrollTop = scrollTopForToday(points[todayIndex]?.y ?? 0, node.clientHeight, maxScroll);
    positioned.current = true;
  }, [height, points, todayIndex, width]);

  useEffect(() => {
    const node = scroller.current;
    if (!node || todayIndex < 0) return undefined;
    const onScroll = () => {
      const y = points[todayIndex]?.y ?? 0;
      const top = node.scrollTop;
      const view = node.clientHeight;
      setScrollTop(top);
      setShowReturn(y < top + 40 || y > top + view - 80);
    };
    onScroll();
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, [points, todayIndex]);

  useEffect(() => {
    const missing = days.find((day, index) => visible.has(index) && day.loaded === false);
    if (missing) onNeed?.(missing.date);
  }, [days, onNeed, visible]);

  const jumpToday = () => {
    const node = scroller.current;
    if (!node || todayIndex < 0) return;
    const maxScroll = Math.max(0, height - node.clientHeight);
    node.scrollTo({ top: scrollTopForToday(points[todayIndex].y, node.clientHeight, maxScroll), behavior: 'smooth' });
  };

  return (
    <div ref={scroller} className="relative h-full overflow-y-auto overscroll-contain" data-journey-map="true">
      <div className="relative" style={{ height, width: '100%' }} onClick={() => onBlank?.()}>
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, #1c245c 0%, #6a4d96 10%, #f0a06a 24%, #8fd4ff 46%, #c5ecff 68%, #d7f5c4 100%)',
          }}
        />
        <svg className="pointer-events-none absolute inset-x-0 top-0 h-64 w-full" viewBox={`0 0 ${width} 220`} aria-hidden="true">
          <path d={`M0 150 L${width * 0.18} 92 L${width * 0.34} 140 L${width * 0.52} 70 L${width * 0.7} 138 L${width * 0.86} 96 L${width} 150 V220 H0 Z`} fill="#8ea4c8" opacity="0.55" />
          <path d={`M0 176 L${width * 0.22} 120 L${width * 0.4} 168 L${width * 0.58} 108 L${width * 0.78} 164 L${width} 124 V220 H0 Z`} fill="#6e8cb4" opacity="0.72" />
          <circle cx={width * 0.78} cy="36" r="10" fill="#f7f3d2" />
        </svg>
        {segments.map((chunk) => (
          <VineStrand
            key={chunk[0].date}
            points={chunk}
            side={wrapPoints(chunk, width, compact)}
            width={width}
            compact={compact}
          />
        ))}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${width} ${height}`} role="presentation">
          <g transform={`translate(${width / 2 - 90} ${height - 108})`}>
            <ellipse cx="90" cy="48" rx="110" ry="26" fill="#5c8a3a" />
            <ellipse cx="90" cy="40" rx="96" ry="22" fill="#8d6240" />
            <ellipse cx="90" cy="34" rx="96" ry="20" fill="#a87548" />
            <path d="M18 34 q8 -16 4 -2 M40 30 q6 -18 2 -2 M150 32 q-8 -16 -2 -2" fill="none" stroke="#67b34a" strokeWidth="3" strokeLinecap="round" />
            <text x="90" y="38" textAnchor="middle" fill="#fff6e4" fontSize="14" fontWeight="700">
              起点
            </text>
          </g>
          <g transform={`translate(${width / 2 - 110} 18)`}>
            <ellipse cx="70" cy="34" rx="36" ry="22" fill="white" />
            <ellipse cx="110" cy="30" rx="48" ry="26" fill="white" />
            <ellipse cx="156" cy="36" rx="32" ry="18" fill="white" />
            <ellipse cx="110" cy="44" rx="70" ry="18" fill="white" />
            <text x="110" y="40" textAnchor="middle" fill="#166534" fontSize="13" fontWeight="700">
              {goalName.slice(0, 12)}
            </text>
          </g>
        </svg>
        {segments.flatMap((chunk) =>
          chunk.slice(0, -1).flatMap((point, index) => {
            const next = chunk[index + 1];
            if (!visible.has(point.index) && !visible.has(next.index)) return [];
            return [0.34, 0.7].map((t, leaf) => {
              const spot = curvePoint(point, next, t);
              const side = leaf === 0 ? 1 : -1;
              const rad = ((spot.angle + 90 * side) * Math.PI) / 180;
              return (
                <span
                  key={`${point.date}-${t}`}
                  className="pointer-events-none absolute"
                  style={{
                    left: spot.x + Math.cos(rad) * 20,
                    top: spot.y + Math.sin(rad) * 16,
                    transform: `translate(-50%, -50%) rotate(${spot.angle + 70 * side}deg)`,
                  }}
                >
                  <LeafMark flip={side} />
                </span>
              );
            });
          }),
        )}
        {points.map((point, index) => {
          if (!visible.has(index)) return null;
          const day = days[index];
          const tag = day.loaded === false ? null : primaryTag(day.tags);
          const showStars = day.state === 'past' || day.state === 'today';
          const size = fruitSize(day);
          const kind = day.state === 'future' || day.loaded === false ? 'bud' : day.state === 'empty' ? 'sprout' : 'fruit';
          const month = day.date.endsWith('-01');
          const phaseName = phaseStart.get(day.date);
          const towardCenter = point.x > width / 2 ? { right: '112%' } : { left: '112%' };
          return (
            <div key={day.date} className="absolute" style={{ left: point.x, top: point.y, transform: 'translate(-50%, -50%)' }}>
              <div className="relative flex items-center justify-center">
                {showStars ? (
                  <div className="absolute bottom-[78%] left-1/2 -translate-x-1/2">
                    <StarCrown
                      filled={day.stars ?? 0}
                      color={day.starColor}
                      preview={day.state === 'today'}
                      compact={compact}
                    />
                  </div>
                ) : null}
                {day.state === 'today' ? (
                  <button
                    type="button"
                    className="absolute bottom-[108%] left-1/2 z-10 min-h-11 min-w-11 -translate-x-1/2"
                    aria-label="今天的芽苗"
                    onClick={(event) => {
                      event.stopPropagation();
                      onBlank?.();
                    }}
                  >
                    <SproutAvatar size={compact ? 46 : 54} />
                  </button>
                ) : null}
                {tag ? (
                  <button
                    type="button"
                    className="journey-flag absolute top-1/2 z-10 -translate-y-1/2 px-2 py-1 text-[11px]"
                    style={{ background: TAG_COLOR[tag], ...towardCenter }}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (tag === 'boss') onBoss(day);
                      else onSelect(day);
                    }}
                  >
                    {TAG_LABEL[tag]}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="relative grid min-h-11 min-w-11 place-items-center"
                  style={{ width: Math.max(44, size), height: Math.max(44, size) }}
                  aria-label={`${day.date.slice(5)} ${day.state === 'today' ? '今天' : ''}`}
                  aria-current={day.state === 'today' ? 'date' : undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(day);
                  }}
                >
                  {day.state === 'today' ? (
                    <span
                      className="absolute inset-[-10px] rounded-full"
                      style={{ background: 'radial-gradient(circle, rgba(255,244,180,0.85), rgba(255,244,180,0))' }}
                    />
                  ) : null}
                  <span className="relative block h-full w-full">
                    <FruitGlyph
                      color={day.starColor}
                      kind={kind}
                      cleared={day.rate === 100 && day.stars === 4}
                    />
                  </span>
                </button>
                {day.rate === 100 && showStars ? (
                  <span className="absolute -right-2 top-0 rounded-full bg-[#ffe08a] px-1.5 py-0.5 text-[10px] font-bold text-[#7a4b00]">
                    全清
                  </span>
                ) : null}
              </div>
              <div className={`journey-date mx-auto mt-1 px-2 py-0.5 text-center text-[11px] font-semibold ${day.state === 'empty' ? 'opacity-60' : ''}`}>
                {day.date.slice(5)}
                {day.state === 'future' && day.total > 0 ? ` · ${day.total}项` : ''}
              </div>
              {month ? (
                <div className="mx-auto mt-1 w-max rounded bg-[#fff4d2] px-1.5 py-0.5 text-[10px] font-bold text-[#9a5b00]">
                  {day.date.slice(5, 7) === '01' ? `${day.date.slice(0, 4)} · 1月` : `${Number(day.date.slice(5, 7))}月`}
                </div>
              ) : null}
              {phaseName ? (
                <div
                  className="absolute top-8 w-max max-w-[140px] rounded-md bg-[#f0d7a2] px-2 py-1 text-[11px] font-bold text-[#6b3e12] shadow"
                  style={towardCenter}
                >
                  {phaseName}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {showReturn ? (
        <button
          type="button"
          onClick={jumpToday}
          className="journey-chip fixed right-3 top-16 z-30 px-3 py-2 text-xs font-bold"
        >
          回到今天
        </button>
      ) : null}
      <span className="sr-only">视口 {viewport}px，已画 {visible.size} 个节点</span>
    </div>
  );
}
