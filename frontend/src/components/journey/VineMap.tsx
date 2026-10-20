import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

import mapPlate from '@/assets/journey/map-plate.jpg';
import signCover from '@/assets/journey/phase-sign-cover.png';
import { StarCrown } from '@/components/journey/glyphs';
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
import { cloudFrameForSegment, coverPoint, PLATE_H, PLATE_SLOTS, PLATE_W } from '@/journey/plate';
import type { JourneyDay, JourneyPhase } from '@/journey/types';

const TAG_LABEL = { boss: '阶段 Boss', reinforce: '补强', carried: '顺延' } as const;
const TAG_COLOR = { reinforce: '#3b82f6', carried: '#f59e0b' } as const;

const CLOUD_FILLS = ['#f7fbff', '#e7f3fd', '#d3e6f8', '#b7d4f4', '#9ec4ee'] as const;

function cloudLobes(width: number, height: number) {
  const count = Math.max(8, Math.round(width / 72));
  const lobes: Array<{ cx: number; cy: number; rx: number; ry: number; fill: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const cx = t * width;
    const wave = Math.sin(index * 1.65) * height * 0.07;
    lobes.push({
      cx,
      cy: height * 0.4 + wave + (index % 2 === 0 ? -height * 0.05 : height * 0.04),
      rx: height * (0.3 + (index % 3) * 0.045),
      ry: height * (0.26 + (index % 4) * 0.03),
      fill: CLOUD_FILLS[index % CLOUD_FILLS.length],
    });
    lobes.push({
      cx: cx + (index % 2 === 0 ? height * 0.04 : -height * 0.03),
      cy: height * 0.66 + wave * 0.35,
      rx: height * (0.28 + (index % 2) * 0.04),
      ry: height * 0.2,
      fill: index % 2 === 0 ? '#a9ccef' : '#8eb6e4',
    });
  }
  return lobes;
}

function cloudSilhouette(width: number, height: number): string {
  const steps = Math.max(6, Math.round(width / 96));
  let path = `M 0 ${height * 0.46}`;
  for (let index = 1; index <= steps; index += 1) {
    const x = (width * index) / steps;
    const y = height * (index % 2 === 0 ? 0.2 : 0.34);
    const cx = x - width / steps / 2;
    const cy = height * (index % 2 === 0 ? 0.08 : 0.28);
    path += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  path += ` L ${width} ${height * 0.72}`;
  for (let index = steps; index >= 0; index -= 1) {
    const x = (width * index) / steps;
    const y = height * (index % 2 === 0 ? 0.9 : 0.74);
    const cx = x + width / steps / 2;
    const cy = height * (index % 2 === 0 ? 0.98 : 0.7);
    path += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return `${path} Z`;
}

const CHAIN_LINKS = Array.from({ length: 13 }, (_, index) => {
  const t = index / 12;
  return {
    x: 22 + t * 476,
    y: 20 + Math.sin(Math.PI * t) * 28,
    rot: (0.5 - t) * 16,
  };
});

function CloudBank({ width, height }: { width: number; height: number }) {
  const lobes = cloudLobes(width, height);
  return (
    <svg className="journey-cloud-body" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <defs>
        <filter id="journey-cloud-feather" x="-8%" y="-18%" width="116%" height="136%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <linearGradient id="journey-cloud-core" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f7fbff" />
          <stop offset="36%" stopColor="#e5f1fc" />
          <stop offset="70%" stopColor="#c5daf6" />
          <stop offset="100%" stopColor="#9dbeea" />
        </linearGradient>
        <radialGradient id="journey-cloud-hi" cx="50%" cy="42%" r="55%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="62%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g filter="url(#journey-cloud-feather)">
        {lobes.map((lobe) => (
          <ellipse key={`feather-${lobe.cx}-${lobe.cy}`} cx={lobe.cx} cy={lobe.cy} rx={lobe.rx + 8} ry={lobe.ry + 6} fill="#d5e7f8" />
        ))}
      </g>
      <path d={cloudSilhouette(width, height)} fill="url(#journey-cloud-core)" />
      {lobes.map((lobe) => (
        <ellipse key={`${lobe.cx}-${lobe.cy}`} cx={lobe.cx} cy={lobe.cy} rx={lobe.rx} ry={lobe.ry} fill={lobe.fill} />
      ))}
      {lobes.filter((_, index) => index % 4 === 0).map((lobe) => (
        <ellipse key={`hi-${lobe.cx}`} cx={lobe.cx} cy={lobe.cy - lobe.ry * 0.35} rx={lobe.rx * 0.42} ry={lobe.ry * 0.28} fill="url(#journey-cloud-hi)" />
      ))}
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
  const cloud = gatePhase && !gateOpen && lockedNodes.length > 0 ? cloudFrameForSegment(lockedNodes.map((item) => item.at), width, viewport) : null;
  const flagOnLeft = cloud ? cloud.poleX > width * 0.75 : false;
  const spans = phaseSpans(phases);
  const phaseMarks = spans.flatMap((span) => {
    const top = plateDays.find((item) => item.day?.date === span.topDate);
    if (!top) return [];
    const next = plateDays.find((item) => item.day?.date === addDaysISO(span.topDate, 1));
    const anchor = phaseSignPoint(top.at, next ? next.at : null);
    const outward = anchor.x > width * 0.55 ? 84 : -84;
    return [{ span, x: Math.min(width - 78, Math.max(78, anchor.x + outward)), y: anchor.y }];
  });

  useEffect(() => {
    const missing = plateDays.find((item) => item.day && item.day.loaded === false);
    if (missing?.day) onNeed?.(missing.day.date);
  }, [onNeed, plateDays]);

  const plateScale = Math.max(width / PLATE_W, viewport / PLATE_H);
  const signCoverAt = coverPoint(818 / PLATE_W, 408 / PLATE_H, width, viewport);

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
          <img
            src={signCover}
            alt=""
            draggable={false}
            className="pointer-events-none absolute z-[1]"
            style={{
              left: signCoverAt.x,
              top: signCoverAt.y,
              width: 182 * plateScale,
              height: 184 * plateScale,
            }}
          />
          {plateDays.map(({ slot, day, at }) => {
            if (!day) return null;
            const tag = day.loaded === false ? null : primaryTag(day.tags.filter((item) => item !== 'boss'));
            const beyondGate = Boolean(gatePhase) && !gateOpen && day.date > gatePhase.endDate;
            const locked = day.state === 'future';
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
          {phaseMarks.map(({ span, x, y }) => (
            <div
              key={span.id}
              className="journey-wood journey-phase-sign"
              data-phase-sign={span.id}
              data-phase-top={span.topDate}
              style={{ left: x, top: y }}
            >
              {span.name.replace(' · ', '：')}
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
                ['--flag-scale' as string]: compact || flagOnLeft ? '1.25' : '1.7',
                ['--lock' as string]: `${Math.round(Math.min(52, Math.max(34, cloud.height * 0.2)))}px`,
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
