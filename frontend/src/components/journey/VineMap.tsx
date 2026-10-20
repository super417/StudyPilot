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
import { cloudGateFrame, coverPoint, PLATE_SLOTS } from '@/journey/plate';
import type { JourneyDay, JourneyPhase } from '@/journey/types';

const TAG_LABEL = { boss: '阶段 Boss', reinforce: '补强', carried: '顺延' } as const;
const TAG_COLOR = { reinforce: '#3b82f6', carried: '#f59e0b' } as const;

/** 云团各瓣在 viewBox 248×160 里的位置。中心不透明，只有最外圈才淡出。 */
const CLOUD_LOBES = [
  { cx: 78, cy: 112, rx: 40, ry: 26, fill: '#9ec4ee' },
  { cx: 168, cy: 114, rx: 42, ry: 24, fill: '#8eb6e6' },
  { cx: 124, cy: 128, rx: 36, ry: 18, fill: '#a9ccef' },
  { cx: 40, cy: 96, rx: 34, ry: 26, fill: '#c5ddf6' },
  { cx: 206, cy: 96, rx: 34, ry: 26, fill: '#b7d2f3' },
  { cx: 74, cy: 74, rx: 44, ry: 34, fill: '#e7f2fc' },
  { cx: 124, cy: 64, rx: 50, ry: 36, fill: '#f4f9ff' },
  { cx: 172, cy: 72, rx: 46, ry: 34, fill: '#d5e6f8' },
  { cx: 98, cy: 98, rx: 34, ry: 24, fill: '#c9dff6' },
  { cx: 154, cy: 100, rx: 38, ry: 22, fill: '#b9d4f4' },
  { cx: 136, cy: 42, rx: 32, ry: 20, fill: '#ffffff' },
  { cx: 184, cy: 38, rx: 28, ry: 20, fill: '#f7fbff' },
  { cx: 92, cy: 48, rx: 24, ry: 16, fill: '#ffffff' },
] as const;

const CHAIN_LINKS = Array.from({ length: 13 }, (_, index) => {
  const t = index / 12;
  return {
    x: 22 + t * 476,
    y: 20 + Math.sin(Math.PI * t) * 28,
    rot: (0.5 - t) * 16,
  };
});

function CloudBank() {
  return (
    <svg className="journey-cloud-body" viewBox="0 0 248 160" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <filter id="journey-cloud-feather" x="-18%" y="-22%" width="136%" height="144%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
        <radialGradient id="journey-cloud-hi" cx="42%" cy="38%" r="62%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="58%" stopColor="#ffffff" stopOpacity="0.92" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="journey-cloud-core" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f7fbff" />
          <stop offset="38%" stopColor="#e4f0fc" />
          <stop offset="72%" stopColor="#c5daf6" />
          <stop offset="100%" stopColor="#9ec0ea" />
        </linearGradient>
      </defs>
      <g filter="url(#journey-cloud-feather)">
        {CLOUD_LOBES.map((lobe) => (
          <ellipse key={`feather-${lobe.cx}-${lobe.cy}`} cx={lobe.cx} cy={lobe.cy} rx={lobe.rx + 5} ry={lobe.ry + 4} fill="#d4e6f8" />
        ))}
      </g>
      <path
        fill="url(#journey-cloud-core)"
        d="M48 98 C36 74 58 44 96 40 C120 22 162 20 186 36 C214 26 234 52 224 78 C238 96 228 122 202 128 C184 148 132 152 104 136 C70 150 34 128 34 106 C28 100 36 98 48 98 Z"
      />
      {CLOUD_LOBES.map((lobe) => (
        <ellipse key={`${lobe.cx}-${lobe.cy}`} cx={lobe.cx} cy={lobe.cy} rx={lobe.rx} ry={lobe.ry} fill={lobe.fill} />
      ))}
      <ellipse cx="112" cy="84" rx="14" ry="9" fill="#8eb4e4" />
      <ellipse cx="158" cy="88" rx="12" ry="8" fill="#9abbe6" />
      <ellipse cx="108" cy="52" rx="18" ry="10" fill="url(#journey-cloud-hi)" />
      <ellipse cx="164" cy="50" rx="16" ry="9" fill="url(#journey-cloud-hi)" />
      <ellipse cx="78" cy="60" rx="11" ry="7" fill="url(#journey-cloud-hi)" />
    </svg>
  );
}

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

  const cloud = gatePhase && !gateOpen && gateDay ? cloudGateFrame(width, viewport) : null;
  const flagOnLeft = cloud ? cloud.poleX > width * 0.75 : false;

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
                  zIndex: day.state === 'today' ? 9 : 8,
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
          {cloud && gatePhase && gateDay ? (
            <div
              className="journey-cloud-gate"
              data-cloud-gate="locked"
              style={{
                left: cloud.left,
                width: cloud.width,
                top: cloud.top,
                height: cloud.height,
                ['--flag-x' as string]: `${cloud.poleX - cloud.left}px`,
                ['--flag-y' as string]: `${cloud.poleY}px`,
                ['--flag-scale' as string]: compact || flagOnLeft ? '1.25' : '1.7',
                ['--lock' as string]: `${Math.round(cloud.width * 0.16)}px`,
              }}
            >
              <CloudBank />
              <div className="journey-cloud-lockset">
                <svg className="journey-cloud-chain" viewBox="0 0 520 88" aria-hidden="true">
                  <defs>
                    <linearGradient id="chain-glass" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                      <stop offset="42%" stopColor="#E8D9FF" stopOpacity="0.78" />
                      <stop offset="100%" stopColor="#C9B4F0" stopOpacity="0.62" />
                    </linearGradient>
                  </defs>
                  {CHAIN_LINKS.map((link) => (
                    <ellipse
                      key={link.x}
                      cx={link.x}
                      cy={link.y}
                      rx="17"
                      ry="10"
                      fill="none"
                      stroke="url(#chain-glass)"
                      strokeWidth="4.2"
                      transform={`rotate(${link.rot} ${link.x} ${link.y})`}
                    />
                  ))}
                </svg>
                <div className="journey-cloud-lock">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <ellipse cx="12" cy="14.5" rx="5.2" ry="6" fill="#8ed84a" />
                    <ellipse cx="10.2" cy="12.4" rx="1.6" ry="2.2" fill="#eaffc4" opacity="0.85" />
                    <path d="M12 9c.4-2.4 2.6-3.4 3.6-2.2" fill="none" stroke="#3f8f1e" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="journey-cloud-lock is-right">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 3.2 14.4 9h6.1l-4.9 3.6 1.9 5.8L12 14.9 6.5 18.4 8.4 12.6 3.5 9h6.1Z" fill="#ffe14a" />
                  </svg>
                </div>
                <div className="journey-cloud-pill">
                  {gatePhase.name.replace(/^阶段. · /, '')}
                </div>
                <div className="journey-cloud-pill is-mint">
                  还差 {remainingDays(gatePhase.endDate, today)} 天
                </div>
              </div>
              <BossPennant
                date={gateDay.date}
                className={`journey-boss-flag is-gate ${flagOnLeft ? 'is-left' : 'is-right'}`}
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
