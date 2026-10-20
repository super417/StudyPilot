import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

import mapPlate from '@/assets/journey/map-plate.jpg';
import { StarCrown } from '@/components/journey/glyphs';
import { LanternFruit } from '@/components/journey/LanternFruit';
import {
  contentHeight,
  currentPhase,
  DESKTOP_STEP,
  layoutDays,
  maxDayShiftBeforeGate,
  MOBILE_STEP,
  flagAnchor,
  phaseGateOpen,
  primaryTag,
  remainingDays,
  scrollTopForToday,
} from '@/journey/layout';
import { coverPoint, PLATE_SLOTS } from '@/journey/plate';
import type { JourneyDay, JourneyPhase } from '@/journey/types';

const TAG_LABEL = { boss: '阶段 Boss', reinforce: '补强', carried: '顺延' } as const;
const TAG_COLOR = { reinforce: '#3b82f6', carried: '#f59e0b' } as const;

function BossPennant({ date, className, onClick }: { date: string; className: string; onClick: (event: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button type="button" className={className} data-tag="boss" onClick={onClick}>
      <span className="journey-boss-pole" aria-hidden="true" />
      <span className="journey-boss-cloth">
        <svg viewBox="0 0 112 44" aria-hidden="true" preserveAspectRatio="none">
          <defs>
            <radialGradient id={`boss-jelly-${date}`} cx="38%" cy="48%" r="72%">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.96" />
              <stop offset="48%" stopColor="#8b5cf6" stopOpacity="0.58" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.12" />
            </radialGradient>
          </defs>
          <path
            d="M2 5 H98 L76 22 L98 39 H2 Z"
            fill={`url(#boss-jelly-${date})`}
            stroke="#fff6e4"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M8 11 Q48 7 90 10" fill="none" stroke="white" strokeOpacity="0.8" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span>阶段 Boss</span>
      </span>
    </button>
  );
}

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
  celebrate?: boolean;
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
  celebrate = false,
}: VineMapProps) {
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
  const todayIndex = days.findIndex((day) => day.date === today);
  const gatePhase = currentPhase(phases, today);
  const gateOpen = phaseGateOpen(gatePhase, days);
  const gateDay = gatePhase ? days.find((day) => day.date === gatePhase.endDate) : undefined;
  const topDelta = Math.max(...PLATE_SLOTS.map((slot) => slot.delta));
  const gateIndex = gateDay ? days.findIndex((day) => day.date === gateDay.date) : -1;
  const maxShift = !gateOpen && gateIndex >= 0 && todayIndex >= 0 ? maxDayShiftBeforeGate(todayIndex, gateIndex, topDelta) : null;
  const maxShiftRef = useRef(maxShift);
  maxShiftRef.current = maxShift;
  const step = compact ? MOBILE_STEP : DESKTOP_STEP;
  const maxScroll = Math.max(0, height - viewport);
  const origin = todayIndex < 0 ? 0 : scrollTopForToday(points[todayIndex]?.y ?? 0, viewport, maxScroll);
  const dayShift = scrollTop == null ? 0 : Math.round((scrollTop - origin) / step);

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
      const limit = maxShiftRef.current;
      let top = node.scrollTop;
      if (limit !== null && Math.round((top - origin) / step) > limit) {
        top = origin + limit * step;
        node.scrollTop = top;
      }
      setScrollTop(top);
      setShowReturn(Math.round((top - origin) / step) !== 0);
    };
    onScroll();
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, [origin, points, step, todayIndex]);

  const plateDays = useMemo(
    () =>
      PLATE_SLOTS.map((slot) => {
        const index = todayIndex + slot.delta + dayShift;
        const day = index >= 0 && index < days.length ? days[index] : undefined;
        return { slot, index, day, at: coverPoint(slot.fx, slot.fy, width, viewport) };
      }),
    [dayShift, days, todayIndex, viewport, width],
  );

  useEffect(() => {
    const missing = plateDays.find((item) => item.day && item.day.loaded === false);
    if (missing?.day) onNeed?.(missing.day.date);
  }, [onNeed, plateDays]);

  const jumpToday = () => {
    const node = scroller.current;
    if (!node || todayIndex < 0) return;
    const maxScroll = Math.max(0, height - node.clientHeight);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollTo({
      top: scrollTopForToday(points[todayIndex].y, node.clientHeight, maxScroll),
      behavior: reduce ? 'auto' : 'smooth',
    });
  };

  return (
    <div
      ref={scroller}
      className="relative h-full overflow-y-auto overscroll-contain"
      data-journey-map="true"
      data-day-shift={dayShift}
    >
      <div className="relative" style={{ height, width: '100%' }}>
        <div className="sticky top-0 z-0 h-[100dvh] overflow-hidden" onClick={() => onBlank?.()}>
          <img src={mapPlate} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
          {plateDays.map(({ slot, day, at }) => {
            if (!day) return null;
            const tag = day.loaded === false ? null : primaryTag(day.tags.filter((item) => item !== 'boss'));
            const beyondGate = Boolean(gatePhase) && !gateOpen && day.date > gatePhase.endDate;
            const showStars = day.state === 'past' || day.state === 'today';
            const anchor = flagAnchor(at.x, width);
            const outward = anchor.side === 'right' ? { left: anchor.offset } : { right: anchor.offset };
            return (
              <div
                key={slot.delta}
                className="absolute"
                style={{
                  left: at.x,
                  top: at.y,
                  transform: 'translate(-50%, -50%)',
                  zIndex: day.state === 'today' ? 5 : 1,
                  opacity: beyondGate ? 0.35 : 1,
                  pointerEvents: beyondGate ? 'none' : undefined,
                }}
              >
                {showStars ? (
                  <div className="pointer-events-none absolute bottom-[70%] left-1/2 -translate-x-1/2">
                    <div className={day.state === 'today' && celebrate ? 'journey-star-pop' : undefined}>
                      <StarCrown filled={day.stars ?? 0} color={day.starColor} preview={day.state === 'today'} compact={compact} />
                    </div>
                  </div>
                ) : null}
                {day.state === 'today' ? (
                  <button
                    type="button"
                    className="absolute bottom-[120%] left-1/2 z-30 min-h-11 min-w-11 -translate-x-1/2"
                    aria-label="今天的芽苗"
                    onClick={(event) => {
                      event.stopPropagation();
                      onBlank?.();
                    }}
                  />
                ) : null}
                {day.state === 'future' && day.loaded !== false ? (
                  <span className="pointer-events-none absolute bottom-[46%] left-1/2 -translate-x-1/2">
                    <LanternFruit size={compact ? 54 : 66} flip={at.x > width / 2 ? -1 : 1} />
                  </span>
                ) : null}
                {tag === 'reinforce' || tag === 'carried' ? (
                  <button
                    type="button"
                    className="journey-flag absolute top-1/2 z-30 -translate-y-1/2 px-2.5 py-1 text-xs"
                    style={{ background: TAG_COLOR[tag], ...outward }}
                    data-tag={tag}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(day);
                    }}
                  >
                    {TAG_LABEL[tag]}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="relative grid min-h-11 min-w-11 place-items-center rounded-full"
                  style={{ width: day.state === 'today' ? 84 : 64, height: day.state === 'today' ? 84 : 64 }}
                  aria-label={`${day.date.slice(5)}${day.state === 'today' ? ' 今天' : ''}`}
                  aria-current={day.state === 'today' ? 'date' : undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(day);
                  }}
                />
                <div className={`journey-date pointer-events-none absolute left-1/2 top-[78%] -translate-x-1/2 whitespace-nowrap px-2 py-0.5 text-center text-[11px] font-semibold ${day.state === 'empty' ? 'opacity-70' : ''}`}>
                  {day.date.slice(5)}
                  {day.state === 'future' && day.total > 0 ? ` · ${day.total}项` : ''}
                </div>
              </div>
            );
          })}
          {gatePhase && !gateOpen && gateDay ? (
            <div className="journey-cloud-gate" data-cloud-gate="locked" style={{ top: '26%' }}>
              <div className="journey-cloud-band" />
              <svg className="journey-cloud-chain" viewBox="0 0 520 48" aria-hidden="true">
                <path
                  d="M8 28 H70 M120 28 H250 M300 28 H430 M470 28 H512"
                  fill="none"
                  stroke="#C3C6EE"
                  strokeWidth="8"
                  strokeLinecap="round"
                />
                <g fill="none" stroke="#BAC1EF" strokeWidth="7">
                  {[40, 78, 150, 188, 226, 330, 368, 406].map((x) => (
                    <rect key={x} x={x} y="14" width="28" height="22" rx="8" />
                  ))}
                </g>
              </svg>
              <div className="journey-cloud-lock" style={{ left: '22%' }}>
                <span aria-hidden="true">✿</span>
              </div>
              <div className="journey-cloud-lock" style={{ left: '58%' }}>
                <span aria-hidden="true">★</span>
              </div>
              <div className="journey-cloud-pill" style={{ left: '18%' }}>
                {gatePhase.name.replace(/^阶段. · /, '')}
              </div>
              <div className="journey-cloud-pill" style={{ left: '54%' }}>
                还差 {remainingDays(gatePhase.endDate, today)} 天
              </div>
              <button
                type="button"
                className="journey-cloud-frame"
                data-boss-frame="true"
                aria-label="阶段总测验"
                onClick={(event) => {
                  event.stopPropagation();
                  onBoss(gateDay);
                }}
              >
                <i />
              </button>
              <BossPennant
                date={gateDay.date}
                className="journey-boss-flag is-right is-gate"
                onClick={(event) => {
                  event.stopPropagation();
                  onBoss(gateDay);
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
      {showReturn ? (
        <button
          type="button"
          onClick={jumpToday}
          data-return="today"
          className="journey-chip fixed right-3 top-16 z-30 min-h-11 px-3 py-2 text-xs font-bold"
        >
          回到今天
        </button>
      ) : null}
      <span className="sr-only">
        {goalName}，{phases.length} 个阶段，视口 {viewport}px，已画 {plateDays.filter((item) => item.day).length} 个节点
      </span>
    </div>
  );
}
