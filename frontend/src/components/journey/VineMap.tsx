import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

import mapPlate from '@/assets/journey/map-plate-clean.jpg';
import { SproutAvatar, StarCrown } from '@/components/journey/glyphs';
import { PodFruit } from '@/components/journey/PodFruit';
import { LanternFruit } from '@/components/journey/LanternFruit';
import { addDaysISO } from '@/lib/dates';
import {
  contentHeight,
  currentPhase,
  DESKTOP_STEP,
  layoutDays,
  maxDayShiftBeforeGate,
  MOBILE_STEP,
  flagAnchor,
  phaseGateOpen,
  phaseSignPoint,
  phaseSpans,
  primaryTag,
  remainingDays,
  scrollLead,
  scrollTopForToday,
} from '@/journey/layout';
import { cloudFrameForSegment, coverPoint, PLATE_H, PLATE_SLOTS, PLATE_W, vineRightPlate } from '@/journey/plate';
import type { JourneyDay, JourneyPhase } from '@/journey/types';

const TAG_LABEL = { boss: '阶段 Boss', reinforce: '补强', carried: '顺延' } as const;
const TAG_COLOR = { reinforce: '#3b82f6', carried: '#f59e0b' } as const;

/** 扁链环：平放的环和侧立的环交替，互相扣住。沿一条轻微下垂的弧排开。 */
const CHAIN_LINKS = Array.from({ length: 21 }, (_, index) => {
  const t = index / 20;
  return {
    x: 16 + t * 488,
    y: 24 + Math.sin(Math.PI * t) * 22,
    rot: (0.5 - t) * 18,
    flat: index % 2 === 0,
  };
});

/**
 * 一朵团状卡通云的鼓包（单位坐标：宽 160、高 100）。
 * 顶部一个大鼓包、两侧小鼓包、底部一排波浪圆瓣，宽约为高的 1.6 倍。
 */
const CLOUD_PUFFS: ReadonlyArray<readonly [number, number, number]> = [
  [80, 36, 30],
  [50, 48, 22],
  [110, 48, 22],
  [28, 60, 16],
  [132, 60, 16],
  [38, 74, 14],
  [58, 78, 15],
  [80, 79, 16],
  [102, 78, 15],
  [122, 74, 14],
];

function CloudPuffs({ sx, sy, ox, oy, k, fill }: { sx: number; sy: number; ox: number; oy: number; k: number; fill: string }) {
  const r = Math.min(sx, sy);
  return (
    <g fill={fill}>
      <rect x={ox + 30 * sx} y={oy + 46 * sy} width={100 * sx} height={30 * sy} />
      {CLOUD_PUFFS.map(([cx, cy, cr]) => (
        <circle key={`${cx}-${cy}`} cx={ox + (80 + (cx - 80) * k) * sx} cy={oy + (57 + (cy - 57) * k) * sy} r={cr * k * r} />
      ))}
    </g>
  );
}

/** 未解锁藤段上的一朵大云：无描边，中心近白、外缘浅蓝，四周大半径羽化到透明。 */
function CloudBank({ width, height }: { width: number; height: number }) {
  const sx = width / 160;
  const sy = height / 100;
  const blur = Math.round(Math.min(width, height) * 0.06);
  return (
    <svg className="journey-cloud-body" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <defs>
        <radialGradient id="journey-cloud-fill" cx="50%" cy="52%" r="58%">
          <stop offset="0%" stopColor="#f7fbff" />
          <stop offset="62%" stopColor="#eef6ff" />
          <stop offset="100%" stopColor="#d9ecff" />
        </radialGradient>
        <filter id="journey-cloud-outer" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={blur} />
        </filter>
        <filter id="journey-cloud-inner" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={blur * 0.22} />
        </filter>
      </defs>
      <g filter="url(#journey-cloud-outer)">
        <CloudPuffs sx={sx} sy={sy} ox={0} oy={0} k={1.06} fill="#d9ecff" />
      </g>
      <g filter="url(#journey-cloud-inner)">
        <CloudPuffs sx={sx} sy={sy} ox={0} oy={0} k={0.95} fill="url(#journey-cloud-fill)" />
      </g>
      <g filter="url(#journey-cloud-inner)" opacity="0.85">
        <CloudPuffs sx={sx} sy={sy} ox={0} oy={0} k={0.78} fill="#f7fbff" />
      </g>
    </svg>
  );
}

function PhaseArrowSign({ name, id }: { name: string; id: string }) {
  const face = `wood-face-${id}`;
  const edge = `wood-edge-${id}`;
  return (
    <div className="journey-phase-arrow">
      <div className="journey-phase-arrow-board">
        <svg viewBox="0 0 220 52" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={edge} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a56a32" />
              <stop offset="100%" stopColor="#6e3e16" />
            </linearGradient>
            <linearGradient id={face} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f8dcb0" />
              <stop offset="38%" stopColor="#e2ae62" />
              <stop offset="100%" stopColor="#c4843a" />
            </linearGradient>
          </defs>
          <path d="M8 7 H162 L210 26 L162 45 H8 Q2 26 8 7 Z" fill={`url(#${edge})`} />
          <path d="M12 11 H158 L196 26 L158 41 H12 Q8 26 12 11 Z" fill={`url(#${face})`} />
          <path d="M22 16 H148" stroke="#fff4df" strokeOpacity="0.7" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M24 35 H132" stroke="#8d5a28" strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" />
          <path d="M48 12 V40" stroke="#d7b07a" strokeOpacity="0.45" strokeWidth="3" />
          <path d="M92 12 V40" stroke="#b88345" strokeOpacity="0.28" strokeWidth="2" />
        </svg>
        <span>{name}</span>
      </div>
      <span className="journey-phase-arrow-post" aria-hidden="true" />
    </div>
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
  const baseOrigin = todayIndex < 0 ? 0 : scrollTopForToday(points[todayIndex]?.y ?? 0, viewport, maxScroll);
  const slotMinDelta = Math.min(...PLATE_SLOTS.map((slot) => slot.delta));
  const origin = baseOrigin + scrollLead(todayIndex, slotMinDelta, step, baseOrigin);
  const dayShift = scrollTop == null ? 0 : Math.round((scrollTop - origin) / step);

  useEffect(() => {
    const node = scroller.current;
    if (!node || positioned.current || todayIndex < 0 || width < 100) return;
    node.scrollTop = origin;
    positioned.current = true;
  }, [height, origin, points, todayIndex, width]);

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

  const lockedNodes = plateDays.filter((item) => item.day && item.day.state === 'future');
  const unlockedFloor = plateDays
    .filter((item) => item.day && item.day.state !== 'future')
    .map((item) => item.at.y)
    .filter((y) => lockedNodes.length === 0 || y > Math.max(...lockedNodes.map((item) => item.at.y)));
  const cloud =
    gatePhase && !gateOpen && lockedNodes.length > 0
      ? cloudFrameForSegment(
          lockedNodes.map((item) => item.at),
          width,
          viewport,
          unlockedFloor.length ? Math.min(...unlockedFloor) : undefined,
        )
      : null;
  const flagOnLeft = cloud ? cloud.poleX > width * 0.72 : false;
  const spans = phaseSpans(phases);
  const phaseMarks = spans.flatMap((span) => {
    const top = plateDays.find((item) => item.day?.date === span.topDate);
    if (!top) return [];
    const next = plateDays.find((item) => item.day?.date === addDaysISO(span.topDate, 1));
    const anchor = phaseSignPoint(top.at, next ? next.at : null);
    const scale = Math.max(width / PLATE_W, viewport / PLATE_H);
    const offsetX = (PLATE_W * scale - width) / 2;
    const offsetY = (PLATE_H * scale - viewport) / 2;
    const plateY = (anchor.y + offsetY) / scale;
    const vineRight = vineRightPlate(plateY - 10, plateY + 10) * scale - offsetX;
    const x = Math.min(width - 228, vineRight + 6);
    return [{ span, x, y: anchor.y }];
  });

  useEffect(() => {
    const missing = plateDays.find((item) => item.day && item.day.loaded === false);
    if (missing?.day) onNeed?.(missing.day.date);
  }, [onNeed, plateDays]);

  const jumpToday = () => {
    const node = scroller.current;
    if (!node || todayIndex < 0) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollTo({
      top: origin,
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
      <div className="relative" style={{ height: Math.max(height, origin + viewport + 1), width: '100%' }}>
        <div className="sticky top-0 z-0 h-[100dvh] overflow-hidden" onClick={() => onBlank?.()}>
          <img src={mapPlate} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
          {plateDays.map(({ slot, day, at }) => {
            if (!day) return null;
            const tag = day.loaded === false ? null : primaryTag(day.tags.filter((item) => item !== 'boss'));
            const beyondGate = Boolean(gatePhase) && !gateOpen && day.date > gatePhase.endDate;
            const locked = day.state === 'future';
            const buried = Boolean(cloud) && locked;
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
                  zIndex: locked ? 2 : day.state === 'today' ? 9 : 8,
                  opacity: buried ? 0 : beyondGate ? 0.35 : 1,
                  pointerEvents: buried || beyondGate ? 'none' : undefined,
                }}
              >
                {day.state === 'past' || day.state === 'empty' ? (
                  <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[72%]">
                    <PodFruit color={day.starColor} unripe={day.state === 'empty'} size={compact ? 44 : 52} />
                  </span>
                ) : null}
                {day.state === 'today' ? (
                  <span
                    className="journey-node-fruit pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[76%]"
                    style={{ width: compact ? 76 : 100, height: compact ? 76 : 100 }}
                  >
                    <SproutAvatar size={compact ? 76 : 100} />
                  </span>
                ) : null}
                {showStars ? (
                  <div className={`pointer-events-none absolute left-1/2 -translate-x-1/2 ${day.state === 'today' ? 'bottom-[150%]' : 'bottom-[92%]'}`}>
                    <div className={day.state === 'today' && celebrate ? 'journey-star-pop' : undefined}>
                      <StarCrown filled={day.stars ?? 0} color={day.starColor} preview={day.state === 'today'} compact={compact || day.state !== 'today'} />
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
                <div className={`journey-date pointer-events-none absolute left-1/2 ${day.state === 'today' ? 'top-[74%]' : 'top-[80%]'} -translate-x-1/2 whitespace-nowrap px-1.5 py-px text-center text-[10px] font-semibold ${day.state === 'empty' ? 'opacity-70' : ''}`}>
                  {day.date.slice(5)}
                  {day.state === 'future' && day.total > 0 ? ` · ${day.total}项` : ''}
                </div>
              </div>
            );
          })}
          {phaseMarks.map(({ span, x, y }) => (
            <div
              key={span.id}
              className="journey-phase-sign"
              data-phase-sign={span.id}
              data-phase-top={span.topDate}
              style={{ left: x, top: y }}
            >
              <PhaseArrowSign id={span.id} name={span.name.replace(' · ', '：')} />
            </div>
          ))}
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
                ['--flag-scale' as string]: compact || flagOnLeft ? '1.15' : '1.35',
                ['--lock' as string]: `${Math.round(Math.min(74, Math.max(56, cloud.height * 0.27)))}px`,
              }}
            >
              <CloudBank width={cloud.width} height={cloud.height} />
              <div className="journey-cloud-lockset">
                <svg className="journey-cloud-chain" viewBox="0 0 520 88" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                  <defs>
                    <linearGradient id="chain-glass" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                      <stop offset="42%" stopColor="#E8D9FF" stopOpacity="0.78" />
                      <stop offset="100%" stopColor="#C9B4F0" stopOpacity="0.62" />
                    </linearGradient>
                  </defs>
                  {CHAIN_LINKS.map((link) =>
                    link.flat ? (
                      <ellipse
                        key={link.x}
                        cx={link.x}
                        cy={link.y}
                        rx="15"
                        ry="8.5"
                        fill="none"
                        stroke="url(#chain-glass)"
                        strokeWidth="4.6"
                        transform={`rotate(${link.rot} ${link.x} ${link.y})`}
                      />
                    ) : (
                      <rect
                        key={link.x}
                        x={link.x - 14}
                        y={link.y - 3.4}
                        width="28"
                        height="6.8"
                        rx="3.4"
                        fill="url(#chain-glass)"
                        stroke="#b79be6"
                        strokeOpacity="0.55"
                        strokeWidth="1"
                        transform={`rotate(${link.rot} ${link.x} ${link.y})`}
                      />
                    ),
                  )}
                </svg>
                <div className="journey-cloud-lock">
                  <svg viewBox="4 6 16 16" aria-hidden="true">
                    <ellipse cx="12" cy="14.5" rx="5.2" ry="6" fill="#8ed84a" />
                    <ellipse cx="10.2" cy="12.4" rx="1.6" ry="2.2" fill="#eaffc4" opacity="0.85" />
                    <path d="M12 9c.4-2.4 2.6-3.4 3.6-2.2" fill="none" stroke="#3f8f1e" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="journey-cloud-lock is-right">
                  <svg viewBox="4 6 16 16" aria-hidden="true">
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
