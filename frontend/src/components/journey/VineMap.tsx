import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

import mapPlate from '@/assets/journey/map-plate-clean.jpg';
import { FruitGlyph, SproutAvatar, StarCrown } from '@/components/journey/glyphs';
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

/**
 * 雾带外轮廓：上沿、下沿各自起伏，两端收圆。
 * 轮廓离框上下各留出羽化的距离，模糊后刚好淡到框边。
 */
function mistOutline(width: number, height: number, inset: number, seed: number, insetBottom = inset): string {
  const steps = 12;
  const top: Array<[number, number]> = [];
  const bottom: Array<[number, number]> = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const x = width * (0.03 + t * 0.94);
    const end = Math.pow(Math.abs(t - 0.5) * 2, 6);
    const topWave = Math.sin(t * Math.PI * 3.1 + seed) * 0.05 + Math.sin(t * Math.PI * 7.3 + seed * 2) * 0.018;
    const botWave = Math.sin(t * Math.PI * 2.6 + seed * 1.7) * 0.045 + Math.sin(t * Math.PI * 6.1 + seed) * 0.016;
    const body = height - inset - insetBottom;
    const topY = inset + body * (0.04 + topWave + end * 0.34);
    const botY = height - insetBottom - body * (0.05 + botWave + end * 0.34);
    top.push([x, topY]);
    bottom.push([x, botY]);
  }
  const curve = (points: Array<[number, number]>) =>
    points
      .slice(1)
      .map((point, index) => {
        const prev = points[index];
        const cx = (prev[0] + point[0]) / 2;
        const cy = (prev[1] + point[1]) / 2;
        return `Q ${prev[0].toFixed(1)} ${prev[1].toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)}`;
      })
      .join(' ');
  const first = top[0];
  const lastTop = top[top.length - 1];
  const lastBottom = bottom[bottom.length - 1];
  const firstBottom = bottom[0];
  return [
    `M ${first[0].toFixed(1)} ${first[1].toFixed(1)}`,
    curve(top),
    `L ${lastTop[0].toFixed(1)} ${lastTop[1].toFixed(1)}`,
    `Q ${(width * 1.0).toFixed(1)} ${(height / 2).toFixed(1)} ${lastBottom[0].toFixed(1)} ${lastBottom[1].toFixed(1)}`,
    curve([...bottom].reverse()),
    `L ${firstBottom[0].toFixed(1)} ${firstBottom[1].toFixed(1)}`,
    `Q 0 ${(height / 2).toFixed(1)} ${first[0].toFixed(1)} ${first[1].toFixed(1)}`,
    'Z',
  ].join(' ');
}

/** 上下沿的絮团，让边缘是一团团软的，不是一条线。 */
function mistPuffs(width: number, height: number, inset: number): Array<{ cx: number; cy: number; r: number }> {
  const puffs: Array<{ cx: number; cy: number; r: number }> = [];
  const count = Math.max(5, Math.round(width / 90));
  for (let index = 0; index < count; index += 1) {
    const t = (index + 0.5) / count;
    const end = Math.pow(Math.abs(t - 0.5) * 2, 4);
    const r = height * (0.17 + 0.05 * Math.sin(index * 2.1)) * (1 - end * 0.45);
    puffs.push({ cx: width * (0.06 + t * 0.88), cy: inset + r * 0.95 + height * end * 0.12, r });
    puffs.push({ cx: width * (0.04 + ((index + 0.9) / count) * 0.88), cy: height - inset - r * 0.9 - height * end * 0.12, r: r * 0.92 });
  }
  return puffs;
}

const CHAIN_LINKS = Array.from({ length: 13 }, (_, index) => {
  const t = index / 12;
  return {
    x: 22 + t * 476,
    y: 20 + Math.sin(Math.PI * t) * 28,
    rot: (0.5 - t) * 16,
  };
});

function CloudBank({ width, height, cover }: { width: number; height: number; cover: Array<{ x: number; y: number }> }) {
  const feather = Math.max(10, Math.round(height * 0.075));
  const inset = feather * 1.6;
  return (
    <svg className="journey-cloud-body" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <defs>
        <filter id="journey-mist-feather" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation={feather} />
        </filter>
        <filter id="journey-mist-soft" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation={feather * 0.55} />
        </filter>
        <linearGradient id="journey-mist-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#fbfdff" />
          <stop offset="100%" stopColor="#e9f1fb" />
        </linearGradient>
        <radialGradient id="journey-mist-hi" cx="50%" cy="42%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g filter="url(#journey-mist-feather)">
        <path d={mistOutline(width, height, inset * 0.5, 0.4)} fill="#f7fbff" />
      </g>
      <g filter="url(#journey-mist-soft)" fill="url(#journey-mist-fill)">
        <path d={mistOutline(width, height, inset, 1.3)} />
        {mistPuffs(width, height, inset * 0.7).map((puff) => (
          <circle key={`${puff.cx.toFixed(0)}-${puff.cy.toFixed(0)}`} cx={puff.cx} cy={puff.cy} r={puff.r} />
        ))}
      </g>
      <g filter="url(#journey-mist-soft)">
        <path d={mistOutline(width, height, height * 0.16, 2.2, height * 0.02)} fill="#ffffff" />
        {cover.map((point) => (
          <ellipse
            key={`${point.x.toFixed(0)}-${point.y.toFixed(0)}`}
            cx={point.x}
            cy={Math.min(point.y + 10, height - feather * 1.2)}
            rx={74}
            ry={Math.min(64, height * 0.3)}
            fill="#ffffff"
          />
        ))}
      </g>
      <ellipse cx={width * 0.5} cy={height * 0.45} rx={width * 0.36} ry={height * 0.24} fill="url(#journey-mist-hi)" />
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
    const nodeRight = Math.max(top.at.x, next ? next.at.x : top.at.x) + 24;
    const x = Math.min(width - 228, Math.max(nodeRight, vineRight + 4));
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
                  <span
                    className="journey-node-fruit pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[64%]"
                    style={{ width: compact ? 66 : 88, height: compact ? 66 : 88, opacity: day.state === 'empty' ? 0.8 : 1 }}
                  >
                    <FruitGlyph color={day.state === 'empty' ? 'gray' : day.starColor} kind="fruit" cleared={false} />
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
                  <div className={`pointer-events-none absolute left-1/2 -translate-x-1/2 ${day.state === 'today' ? 'bottom-[150%]' : 'bottom-[122%]'}`}>
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
              <CloudBank
                width={cloud.width}
                height={cloud.height}
                cover={lockedNodes.map((item) => ({ x: item.at.x - cloud.left, y: item.at.y - cloud.top }))}
              />
              <div className="journey-cloud-lockset">
                <svg className="journey-cloud-chain" viewBox="0 0 520 88" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
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
                      strokeWidth="5.4"
                      transform={`rotate(${link.rot} ${link.x} ${link.y})`}
                    />
                  ))}
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
