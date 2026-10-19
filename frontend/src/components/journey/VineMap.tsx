import { useEffect, useId, useMemo, useRef, useState } from 'react';

import cloud from '@/assets/journey/cloud.webp';
import mapSky from '@/assets/journey/map-sky.webp';
import { FruitGlyph, LeafMark, SproutAvatar, StarCrown } from '@/components/journey/glyphs';
import {
  climbSpan,
  columnCenterX,
  columnRadius,
  contentHeight,
  layoutDays,
  primaryTag,
  scrollTopForToday,
  vinePath,
  visibleIndices,
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
  climb?: boolean;
  celebrate?: boolean;
}

function spinePoints(points: NodePoint[], width: number, compact: boolean) {
  return points.map((point) => ({
    ...point,
    x: columnCenterX(point.index, width, compact),
  }));
}

function weavePath(points: NodePoint[], radius: number, phase: number, amount: number): string {
  return vinePath(
    points.map((point) => ({
      x: point.x + Math.sin(point.index * 1.05 + phase) * radius * amount,
      y: point.y,
    })),
  );
}

function fruitSize(day: JourneyDay): number {
  if (day.state === 'future' || day.loaded === false) return 46;
  if (day.state === 'empty') return 40;
  const base = day.stars === 4 ? 72 : day.stars === 3 ? 64 : day.stars === 2 ? 56 : 48;
  return day.state === 'today' ? base + 22 : base;
}

function tendrilOnColumn(point: { x: number; y: number; index: number }, radius: number): string {
  const side = Math.sin(point.index * 1.05) >= 0 ? 1 : -1;
  const x0 = point.x + side * radius * 0.96;
  const y0 = point.y + 8;
  const x1 = x0 + side * 22;
  const y1 = y0 - 26;
  const x2 = x1 - side * 8;
  const y2 = y1 + 18;
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} Q ${x1.toFixed(1)} ${y1.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function VineStrand({
  points,
  width,
  compact,
}: {
  points: NodePoint[];
  width: number;
  compact: boolean;
}) {
  const gid = useId().replace(/:/g, '');
  const spine = spinePoints(points, width, compact);
  const main = vinePath(spine);
  const radius = columnRadius(width, compact);
  const y0 = Math.min(spine[0].y, spine[spine.length - 1].y) - radius;
  const y1 = Math.max(spine[0].y, spine[spine.length - 1].y) + radius;
  const body = radius * 2;
  return (
    <svg className="pointer-events-none absolute left-0" style={{ top: y0, width: '100%', height: y1 - y0 }} viewBox={`0 ${y0} ${width} ${y1 - y0}`}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#146b32" />
          <stop offset="28%" stopColor="#3cb44a" />
          <stop offset="52%" stopColor="#b6f07a" />
          <stop offset="78%" stopColor="#2f9a40" />
          <stop offset="100%" stopColor="#0e5a28" />
        </linearGradient>
      </defs>
      <path d={main} stroke="#08381c" strokeWidth={body + 26} fill="none" strokeLinecap="round" />
      <path d={main} stroke={`url(#${gid})`} strokeWidth={body} fill="none" strokeLinecap="round" />
      <path d={weavePath(spine, radius, Math.PI, 0.72)} stroke="#0c4f24" strokeWidth={radius * 0.3} fill="none" strokeLinecap="round" opacity="0.55" />
      <path d={weavePath(spine, radius, 0.2, 0.74)} stroke="#f4ffd2" strokeWidth={radius * 0.26} fill="none" strokeLinecap="round" opacity="0.9" />
      {spine.map((point) => (
        <path key={point.date} d={tendrilOnColumn(point, radius)} stroke="#7dce55" strokeWidth={compact ? 5 : 7} fill="none" strokeLinecap="round" />
      ))}
    </svg>
  );
}

export default function VineMap({
  days,
  phases,
  today,
  goalName,
  compact,
  onSelect,
  onBoss,
  onNeed,
  onBlank,
  climb = false,
  celebrate = false,
}: VineMapProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [viewport, setViewport] = useState(640);
  const [scrollTop, setScrollTop] = useState<number | null>(null);
  const [showReturn, setShowReturn] = useState(false);
  const [climber, setClimber] = useState<{ x: number; y: number } | null>(null);
  const pathRef = useRef<SVGPathElement>(null);
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
  const span = climbSpan(todayIndex);
  const climbPath = span
    ? vinePath(spinePoints(points.slice(span.start, span.end + 1), width, compact))
    : '';
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
    const path = pathRef.current;
    if (!climb || !path || !climbPath) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const length = path.getTotalLength();
    if (length <= 0) return undefined;
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 1100);
      const point = path.getPointAtLength(length * t);
      setClimber({ x: point.x, y: point.y });
      if (t < 1) frame = requestAnimationFrame(tick);
      else setClimber(null);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [climb, climbPath]);

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
        <div className="pointer-events-none sticky top-0 z-0 h-[100dvh] overflow-hidden">
          <img src={mapSky} alt="" className="h-full w-full object-cover object-top" />
          <img src={cloud} alt="" draggable={false} className="journey-drift absolute left-[4%] top-[6%] w-[min(34vw,280px)]" />
          <img
            src={cloud}
            alt=""
            draggable={false}
            className="journey-drift absolute left-[36%] top-[16%] w-[min(30vw,240px)]"
            style={{ animationDelay: '-5s' }}
          />
          <img
            src={cloud}
            alt=""
            draggable={false}
            className="journey-drift absolute right-[4%] top-[8%] w-[min(28vw,220px)]"
            style={{ animationDelay: '-11s' }}
          />
        </div>
        <div className="absolute inset-0">
        <svg className="pointer-events-none absolute h-0 w-0" aria-hidden="true">
          <path ref={pathRef} d={climbPath} />
        </svg>
        {segments.map((chunk) => (
          <VineStrand key={chunk[0].date} points={chunk} width={width} compact={compact} />
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
        </svg>
        <div className="pointer-events-none absolute left-1/2 top-3 z-[2] w-[min(46vw,240px)] -translate-x-1/2">
          <img src={cloud} alt="" draggable={false} className="w-full" />
          <div className="absolute inset-0 grid place-items-center px-6 text-center text-[13px] font-bold text-[#166534]">
            {goalName.slice(0, 12)}
          </div>
        </div>
        {segments.flatMap((chunk) =>
          spinePoints(chunk, width, compact).flatMap((point) => {
            if (!visible.has(point.index)) return [];
            const radius = columnRadius(width, compact);
            const side = Math.sin(point.index * 1.05) >= 0 ? 1 : -1;
            const spots = [{ x: point.x + side * radius * 0.9, y: point.y - 16, flip: side, rot: side * 24 }];
            if (point.index % 2 === 0) {
              spots.push({ x: point.x - side * radius * 0.84, y: point.y + 18, flip: -side, rot: -side * 36 });
            }
            return spots.map((spot, leaf) => (
              <span
                key={`${point.date}-leaf-${leaf}`}
                className="pointer-events-none absolute"
                style={{ left: spot.x, top: spot.y, transform: `translate(-50%, -50%) rotate(${spot.rot}deg)` }}
              >
                <LeafMark flip={spot.flip} size={compact ? 30 : 42} />
              </span>
            ));
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
          const outward = point.x > width / 2 ? { left: '108%' } : { right: '108%' };
          return (
            <div
              key={day.date}
              className="absolute"
              style={{ left: point.x, top: point.y, transform: 'translate(-50%, -50%)', zIndex: day.state === 'today' ? 5 : 1 }}
            >
              <div className="relative flex items-center justify-center">
                {showStars ? (
                  <div className="absolute bottom-[78%] left-1/2 -translate-x-1/2">
                    <div className={day.state === 'today' && celebrate ? 'journey-star-pop' : undefined}>
                      <StarCrown
                        filled={day.stars ?? 0}
                        color={day.starColor}
                        preview={day.state === 'today'}
                        compact={compact}
                      />
                    </div>
                  </div>
                ) : null}
                {day.state === 'today' ? (
                  <button
                    type="button"
                    className="absolute bottom-[118%] left-1/2 z-30 min-h-11 min-w-11 -translate-x-1/2"
                    aria-label="今天的芽苗"
                    onClick={(event) => {
                      event.stopPropagation();
                      onBlank?.();
                    }}
                  >
                    {climber ? null : <SproutAvatar size={compact ? 64 : 78} />}
                  </button>
                ) : null}
                {tag ? (
                  <button
                    type="button"
                    className="journey-flag absolute top-1/2 z-10 -translate-y-1/2 px-2 py-1 text-[11px]"
                    style={{ background: TAG_COLOR[tag], ...outward }}
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
                    <>
                      <span
                        className="journey-breathe pointer-events-none absolute rounded-full"
                        style={{
                          inset: '-30%',
                          background:
                            'radial-gradient(circle, rgba(255,246,170,0.98) 0%, rgba(255,206,50,0.55) 42%, rgba(255,206,50,0) 72%)',
                        }}
                      />
                      <span
                        className="pointer-events-none absolute rounded-full border-4 border-[#ffe56a]"
                        style={{ inset: '-12%', boxShadow: '0 0 0 6px rgba(255,214,60,0.55)' }}
                      />
                    </>
                  ) : null}
                  {day.state === 'today' && day.rate === 100 ? (
                    <span className="journey-ring pointer-events-none absolute inset-[-4px] rounded-full border-[3px] border-dashed border-[#ffe08a]" />
                  ) : null}
                  <span className={`relative block h-full w-full ${day.state === 'today' ? 'journey-breathe' : ''}`}>
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
              <div className={`journey-date pointer-events-none mx-auto mt-1 px-2 py-0.5 text-center text-[11px] font-semibold ${day.state === 'empty' ? 'opacity-60' : ''}`}>
                {day.date.slice(5)}
                {day.state === 'future' && day.total > 0 ? ` · ${day.total}项` : ''}
              </div>
              {month ? (
                <div className="pointer-events-none mx-auto mt-1 w-max rounded bg-[#fff4d2] px-1.5 py-0.5 text-[10px] font-bold text-[#9a5b00]">
                  {day.date.slice(5, 7) === '01' ? `${day.date.slice(0, 4)} · 1月` : `${Number(day.date.slice(5, 7))}月`}
                </div>
              ) : null}
              {phaseName ? (
                <div
                  className="journey-wood absolute top-10 w-max max-w-[180px] px-3 py-1.5 text-[13px] font-bold"
                  style={outward}
                >
                  {phaseName}
                </div>
              ) : null}
            </div>
          );
        })}
        {climber ? (
          <div className="pointer-events-none absolute z-20" style={{ left: climber.x, top: climber.y, transform: 'translate(-50%, -110%)' }}>
            <SproutAvatar size={compact ? 64 : 78} />
          </div>
        ) : null}
        </div>
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
