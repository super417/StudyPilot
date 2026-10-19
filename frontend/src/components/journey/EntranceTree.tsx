import { useId, useState, type MouseEvent } from 'react';

import { FruitGlyph, StarCrown } from '@/components/journey/glyphs';
import type { StarColor } from '@/journey/stars';

export interface EntranceFruit {
  date: string;
  color: StarColor | null;
  kind: 'fruit' | 'bud' | 'sprout';
  cleared: boolean;
}

const FRUIT_SLOTS = [
  { left: '12%', top: '34%' },
  { left: '28%', top: '20%' },
  { left: '46%', top: '12%' },
  { left: '66%', top: '18%' },
  { left: '80%', top: '34%' },
  { left: '22%', top: '48%' },
  { left: '58%', top: '46%' },
];

const FALLING = [
  { left: '12%', delay: '0s', duration: '12s' },
  { left: '28%', delay: '2s', duration: '10s' },
  { left: '46%', delay: '4.5s', duration: '13s' },
  { left: '68%', delay: '1s', duration: '11s' },
  { left: '84%', delay: '3.2s', duration: '9s' },
];

function Cloud({ className }: { className?: string }) {
  return (
    <svg className={className} width="180" height="70" viewBox="0 0 180 70" aria-hidden="true">
      <ellipse cx="48" cy="42" rx="36" ry="18" fill="white" />
      <ellipse cx="86" cy="32" rx="44" ry="24" fill="white" />
      <ellipse cx="128" cy="40" rx="32" ry="16" fill="white" />
      <ellipse cx="70" cy="28" rx="16" ry="8" fill="#f7fbff" opacity="0.8" />
    </svg>
  );
}

function Pine({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x="-4" y="28" width="8" height="16" fill="#6b4428" />
      <path d="M0 0 L18 32 H-18 Z" fill="#2f8a3c" />
      <path d="M0 12 L22 40 H-22 Z" fill="#3aaa4a" />
      <path d="M-8 16 L-2 22" stroke="white" strokeWidth="2" opacity="0.35" />
    </g>
  );
}

function Flower({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M0 0 V16" stroke="#3d9a45" strokeWidth="2" />
      <circle cx="0" cy="0" r="5" fill={color} />
      <circle cx="0" cy="-6" r="4" fill={color} />
      <circle cx="5" cy="-2" r="4" fill={color} />
      <circle cx="-5" cy="-2" r="4" fill={color} />
      <circle cx="0" cy="-2" r="2" fill="#ffe56a" />
    </g>
  );
}

export function EntranceTree({
  streakDays,
  weekStars,
  fruits,
  compact,
  leaving,
  reducedMotion,
  onStart,
  onBack,
}: {
  streakDays: number | null;
  weekStars: number | null;
  fruits: EntranceFruit[];
  compact: boolean;
  leaving: boolean;
  reducedMotion: boolean;
  onStart: () => void;
  onBack: () => void;
}) {
  const heatId = useId().replace(/:/g, '');
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    if (compact || reducedMotion || leaving) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const nx = (event.clientX - rect.left - rect.width / 2) / (rect.width / 2);
    const ny = (event.clientY - rect.top - rect.height / 2) / (rect.height / 2);
    setShift({ x: Math.max(-8, Math.min(8, nx * 8)), y: Math.max(-6, Math.min(6, ny * 6)) });
  };
  const sign = (
    <>
      <div>{streakDays === null ? '已连续 — 天' : `已连续 ${streakDays} 天`}</div>
      <div>{weekStars === null ? '本周 — ★' : `本周 ${weekStars} ★`}</div>
    </>
  );

  return (
    <div
      className={`absolute inset-0 overflow-hidden ${leaving ? 'journey-leave' : ''}`}
      data-scene="entrance"
      onMouseMove={onMove}
    >
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, #79c8ff 0%, #b7e4ff 42%, #d9f3ff 68%, #8ed36a 100%)' }} />
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <path d="M0 520 L180 430 L320 500 L520 360 L700 470 L900 340 L1100 480 L1280 390 L1440 470 V900 H0 Z" fill="#b7cbe4" />
        <path d="M0 580 L220 490 L420 560 L640 450 L860 560 L1080 470 L1440 540 V900 H0 Z" fill="#8eafd0" />
        <path d="M0 700 C240 640 420 680 720 650 C1020 620 1200 670 1440 630 V900 H0 Z" fill="#7dbe55" />
        <path d="M0 760 C300 710 560 750 860 720 C1120 694 1280 740 1440 710 V900 H0 Z" fill="#63a844" />
        <path d="M0 820 C400 790 800 810 1440 780 V900 H0 Z" fill="#8ed36a" />
        <Pine x={90} y={560} scale={1.3} />
        <Pine x={190} y={600} scale={0.9} />
        <Pine x={1240} y={540} scale={1.4} />
        <Pine x={1340} y={590} scale={1} />
        <g fill="#3d9a45">
          <ellipse cx="260" cy="690" rx="40" ry="16" />
          <ellipse cx="1180" cy="680" rx="50" ry="18" />
          <ellipse cx="1080" cy="710" rx="28" ry="12" />
        </g>
        <Flower x={120} y={800} color="#ff8eb8" />
        <Flower x={180} y={830} color="#fff" />
        <Flower x={1260} y={810} color="#ffb0cc" />
        <Flower x={1320} y={790} color="#ffe56a" />
        <Flower x={240} y={820} color="#ffd0e4" />
      </svg>
      <Cloud className="journey-drift pointer-events-none absolute left-[4%] top-[8%]" />
      <Cloud className="journey-drift pointer-events-none absolute left-[34%] top-[4%]" />
      <Cloud className="journey-drift pointer-events-none absolute right-[6%] top-[16%]" />
      {FALLING.map((leaf) => (
        <span
          key={leaf.left}
          className="journey-fall pointer-events-none absolute top-0"
          style={{ left: leaf.left, animationDelay: leaf.delay, animationDuration: leaf.duration }}
        >
          <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
            <path d="M1 6 C5 1 12 1 17 6 C12 11 5 11 1 6 Z" fill="#7ed957" stroke="#2f8a3a" strokeWidth="0.8" />
          </svg>
        </span>
      ))}
      <svg className="pointer-events-none absolute right-[4%] top-[4%] h-36 w-36" viewBox="0 0 160 160" aria-hidden="true">
        <defs>
          <radialGradient id={`${heatId}-halo`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff4c4" stopOpacity="0.95" />
            <stop offset="45%" stopColor="#ffe08a" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#ffe08a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${heatId}-sun`} cx="38%" cy="34%" r="70%">
            <stop offset="0%" stopColor="#fffbe8" />
            <stop offset="40%" stopColor="#ffd15a" />
            <stop offset="100%" stopColor="#ff9a2e" />
          </radialGradient>
          {reducedMotion ? null : (
            <filter id={heatId} x="-40%" y="-40%" width="180%" height="180%">
              <feTurbulence type="turbulence" baseFrequency="0.012" numOctaves="2" seed="4" result="noise">
                <animate attributeName="baseFrequency" values="0.01;0.022;0.01" dur="6s" repeatCount="indefinite" />
              </feTurbulence>
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="8" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          )}
        </defs>
        <circle cx="80" cy="80" r="70" fill={`url(#${heatId}-halo)`} />
        <g filter={reducedMotion ? undefined : `url(#${heatId})`}>
          <g className="journey-spin">
            {Array.from({ length: 16 }, (_, index) => (
              <rect key={index} x="76" y="6" width="8" height="28" rx="4" fill="#ffe7a0" transform={`rotate(${index * 22.5} 80 80)`} />
            ))}
          </g>
          <circle cx="80" cy="80" r="34" fill={`url(#${heatId}-sun)`} stroke="#fff6d0" strokeWidth="4" />
        </g>
      </svg>
      <button type="button" className="journey-chip absolute left-3 top-3 z-30 px-3 py-2 text-xs font-bold" onClick={onBack}>
        返回
      </button>
      <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-14">
        <div className="journey-plaque flex items-center gap-2 px-5 py-2 text-lg font-black">
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 1.5 l2.2 4.6 5 .7 -3.6 3.5.9 5.1 L10 13.2 5.5 15.4 l.9-5.1 L2.8 6.8 l5-.7 Z" fill="#ffe56a" stroke="#fff" strokeWidth="1" />
          </svg>
          星藤航图
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 1.5 l2.2 4.6 5 .7 -3.6 3.5.9 5.1 L10 13.2 5.5 15.4 l.9-5.1 L2.8 6.8 l5-.7 Z" fill="#ffe56a" stroke="#fff" strokeWidth="1" />
          </svg>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-[16%] top-14 z-10" style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}>
        <button
          type="button"
          className={`journey-tree-hover absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${compact ? 'h-[min(50dvh,420px)] w-[min(88vw,380px)]' : 'h-[min(68dvh,620px)] w-[min(52vw,560px)]'}`}
          onClick={onStart}
          aria-label="点击大树 开始今日航线"
        >
          <span className="journey-sway block h-full w-full">
            <svg viewBox="0 0 520 680" className="h-full w-full" aria-hidden="true">
              <ellipse cx="260" cy="640" rx="170" ry="22" fill="rgba(40,90,20,0.16)" />
              <path d="M230 600 C150 630 70 650 20 670" fill="none" stroke="#6b3e12" strokeWidth="28" strokeLinecap="round" />
              <path d="M290 600 C380 632 450 655 510 678" fill="none" stroke="#6b3e12" strokeWidth="26" strokeLinecap="round" />
              <path d="M200 590 C120 600 80 590 40 610" fill="none" stroke="#8d5a32" strokeWidth="16" strokeLinecap="round" />
              <path d="M320 592 C400 608 460 600 500 628" fill="none" stroke="#8d5a32" strokeWidth="14" strokeLinecap="round" />
              <path d="M248 610 C220 500 280 420 236 330 C206 260 250 200 258 150" fill="none" stroke="#5c3418" strokeWidth="78" strokeLinecap="round" />
              <path d="M248 610 C220 500 280 420 236 330 C206 260 250 200 258 150" fill="none" stroke="#a56b3c" strokeWidth="46" strokeLinecap="round" />
              <path d="M236 590 C214 490 262 410 230 330" fill="none" stroke="#e7c49a" strokeWidth="10" strokeLinecap="round" opacity="0.7" />
              <path d="M210 590 C270 520 180 470 250 410 C180 360 260 300 220 230 C250 190 230 160 250 130" fill="none" stroke="#146b32" strokeWidth="22" strokeLinecap="round" />
              <path d="M210 590 C270 520 180 470 250 410 C180 360 260 300 220 230 C250 190 230 160 250 130" fill="none" stroke="#5dce62" strokeWidth="12" strokeLinecap="round" />
              <g className="journey-leaf" style={{ animationDelay: '0.1s' }}>
                <ellipse cx="250" cy="230" rx="168" ry="128" fill="#2f8f3d" />
                <ellipse cx="140" cy="280" rx="100" ry="78" fill="#248336" />
                <ellipse cx="370" cy="270" rx="110" ry="84" fill="#3aaa48" />
              </g>
              <g className="journey-leaf" style={{ animationDelay: '0.6s' }}>
                <ellipse cx="190" cy="200" rx="96" ry="74" fill="#57c85a" />
                <ellipse cx="320" cy="186" rx="108" ry="80" fill="#6ad468" />
                <ellipse cx="250" cy="150" rx="90" ry="64" fill="#8ee07a" />
              </g>
              <g className="journey-leaf" style={{ animationDelay: '1.1s' }}>
                <ellipse cx="120" cy="250" rx="48" ry="30" fill="#b6f07a" />
                <ellipse cx="400" cy="230" rx="52" ry="32" fill="#d4f7a4" />
                <ellipse cx="250" cy="120" rx="46" ry="28" fill="#c6f58a" />
                <ellipse cx="168" cy="168" rx="36" ry="16" fill="white" opacity="0.45" />
                <ellipse cx="300" cy="150" rx="40" ry="16" fill="white" opacity="0.4" />
                <ellipse cx="230" cy="210" rx="50" ry="18" fill="white" opacity="0.22" />
              </g>
              <path d="M70 250 q30 -20 18 10" fill="none" stroke="white" strokeWidth="3" opacity="0.45" strokeLinecap="round" />
              <path d="M430 220 q-36 -16 -10 18" fill="none" stroke="white" strokeWidth="3" opacity="0.4" strokeLinecap="round" />
            </svg>
            {fruits.map((fruit, index) => {
              const slot = FRUIT_SLOTS[index];
              if (!slot) return null;
              return (
                <span key={fruit.date} className="absolute block h-14 w-14" style={slot}>
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <StarCrown filled={fruit.cleared ? 4 : 3} color={fruit.color} preview={false} compact />
                  </span>
                  <FruitGlyph color={fruit.color} kind={fruit.kind === 'bud' ? 'fruit' : fruit.kind} cleared={fruit.cleared} />
                </span>
              );
            })}
            <div className="journey-sign absolute bottom-[16%] left-1/2 w-max -translate-x-1/2 px-3 py-1.5 text-center text-xs font-black leading-5">
              {sign}
            </div>
          </span>
        </button>
      </div>
      <div className="journey-ripple" />
      <div className="absolute inset-x-0 bottom-3 z-20 flex justify-center px-4 pb-[env(safe-area-inset-bottom)]">
        <button type="button" className="journey-cta px-6 py-3 text-base font-black" onClick={onStart}>
          点击大树 开始今日航线
        </button>
      </div>
    </div>
  );
}
