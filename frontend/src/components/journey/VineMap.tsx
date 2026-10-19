import { useEffect, useMemo, useRef, useState } from 'react';

import { FruitGlyph, SproutAvatar, StarCrown } from '@/components/journey/glyphs';
import {
  contentHeight,
  layoutDays,
  primaryTag,
  scrollTopForToday,
  vinePath,
  wrapPoints,
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
}

function fruitSize(day: JourneyDay): number {
  if (day.state === 'future' || day.loaded === false) return 46;
  if (day.state === 'empty') return 40;
  const base = day.stars === 4 ? 72 : day.stars === 3 ? 64 : day.stars === 2 ? 56 : 48;
  return day.state === 'today' ? base + 14 : base;
}

export default function VineMap({ days, phases, today, goalName, compact, onSelect, onBoss }: VineMapProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [viewport, setViewport] = useState(640);
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
  const mainPath = useMemo(() => vinePath(points), [points]);
  const sidePath = useMemo(() => vinePath(wrapPoints(points, width, compact)), [points, width, compact]);
  const phaseStart = useMemo(() => new Map(phases.map((phase) => [phase.startDate, phase.name])), [phases]);
  const todayIndex = days.findIndex((day) => day.date === today);

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
      setShowReturn(y < top + 40 || y > top + view - 80);
    };
    onScroll();
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, [points, todayIndex]);

  const jumpToday = () => {
    const node = scroller.current;
    if (!node || todayIndex < 0) return;
    const maxScroll = Math.max(0, height - node.clientHeight);
    node.scrollTo({ top: scrollTopForToday(points[todayIndex].y, node.clientHeight, maxScroll), behavior: 'smooth' });
  };

  return (
    <div ref={scroller} className="relative h-full overflow-y-auto overscroll-contain" data-journey-map="true">
      <div className="relative" style={{ height, width: '100%' }}>
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${width} ${height}`} role="presentation">
          <defs>
            <linearGradient id="vine-body" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#b6f27a" />
              <stop offset="45%" stopColor="#3cb85a" />
              <stop offset="100%" stopColor="#1f8a3c" />
            </linearGradient>
          </defs>
          <path d={mainPath} stroke="#146b32" strokeWidth={compact ? 26 : 34} fill="none" strokeLinecap="round" />
          <path d={mainPath} stroke="url(#vine-body)" strokeWidth={compact ? 18 : 24} fill="none" strokeLinecap="round" />
          <path d={mainPath} stroke="white" strokeWidth="5" fill="none" strokeLinecap="round" opacity="0.38" transform="translate(-2 -3)" />
          <path d={sidePath} stroke="#7ed957" strokeWidth={compact ? 8 : 11} fill="none" strokeLinecap="round" opacity="0.9" />
          <g transform={`translate(${width / 2 - 70} ${height - 92})`}>
            <ellipse cx="70" cy="36" rx="78" ry="22" fill="#6d4b2b" />
            <ellipse cx="70" cy="30" rx="78" ry="20" fill="#8d6240" />
            <text x="70" y="34" textAnchor="middle" fill="#fff6e4" fontSize="14" fontWeight="700">
              起点
            </text>
          </g>
          <g transform={`translate(${width / 2 - 90} 36)`}>
            <ellipse cx="90" cy="28" rx="78" ry="24" fill="white" opacity="0.92" />
            <ellipse cx="48" cy="24" rx="28" ry="18" fill="white" />
            <ellipse cx="128" cy="24" rx="26" ry="16" fill="white" />
            <text x="90" y="32" textAnchor="middle" fill="#166534" fontSize="13" fontWeight="700">
              {goalName.slice(0, 12)}
            </text>
          </g>
        </svg>
        {points.map((point, index) => {
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
                  <div className="absolute bottom-[108%] left-1/2 z-10 -translate-x-1/2">
                    <SproutAvatar size={compact ? 46 : 54} />
                  </div>
                ) : null}
                {tag ? (
                  <button
                    type="button"
                    className="journey-flag absolute top-1/2 z-10 -translate-y-1/2 px-2 py-1 text-[11px]"
                    style={{ background: TAG_COLOR[tag], ...towardCenter }}
                    onClick={() => (tag === 'boss' ? onBoss(day) : onSelect(day))}
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
                  onClick={() => onSelect(day)}
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
      <span className="sr-only" data-viewport={viewport} />
    </div>
  );
}
