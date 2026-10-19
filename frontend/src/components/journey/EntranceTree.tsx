import { useId, useState, type MouseEvent } from 'react';

import { FruitGlyph } from '@/components/journey/glyphs';
import type { StarColor } from '@/journey/stars';

export interface EntranceFruit {
  date: string;
  color: StarColor | null;
  kind: 'fruit' | 'bud' | 'sprout';
  cleared: boolean;
}

const FRUIT_SLOTS = [
  { left: '16%', top: '38%' },
  { left: '30%', top: '24%' },
  { left: '46%', top: '16%' },
  { left: '62%', top: '22%' },
  { left: '76%', top: '36%' },
  { left: '36%', top: '46%' },
  { left: '58%', top: '48%' },
];

function Cloud({ className }: { className?: string }) {
  return (
    <svg className={className} width="150" height="56" viewBox="0 0 150 56" aria-hidden="true">
      <ellipse cx="42" cy="34" rx="30" ry="16" fill="white" />
      <ellipse cx="74" cy="26" rx="36" ry="20" fill="white" />
      <ellipse cx="108" cy="34" rx="26" ry="14" fill="white" />
    </svg>
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

  return (
    <div
      className={`absolute inset-0 overflow-hidden ${leaving ? 'journey-leave' : ''}`}
      data-scene="entrance"
      onMouseMove={onMove}
    >
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(180deg, #7ec8ff 0%, #d7f3ff 46%, #c6ef9a 78%, #8dcc62 100%)' }}
      />
      <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-[42%] w-full" viewBox="0 0 800 280" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 120 L90 70 L170 130 L280 40 L390 120 L500 54 L620 130 L720 78 L800 120 V280 H0 Z" fill="#9eb6d6" />
        <path d="M0 168 L120 100 L230 160 L360 86 L470 156 L600 96 L800 150 V280 H0 Z" fill="#7f9cc4" />
        <path d="M0 230 C160 190 280 210 400 188 C540 164 640 200 800 170 V280 H0 Z" fill="#7dbe55" />
        <path d="M0 248 C180 220 320 236 480 214 C620 198 700 226 800 206 V280 H0 Z" fill="#67a844" />
      </svg>
      <Cloud className="journey-drift pointer-events-none absolute left-[6%] top-[12%]" />
      <Cloud className="journey-drift pointer-events-none absolute left-[38%] top-[6%]" />
      <Cloud className="journey-drift pointer-events-none absolute right-[8%] top-[18%]" />
      <svg className="pointer-events-none absolute right-[8%] top-[6%] h-28 w-28" viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <radialGradient id={`${heatId}-sun`} cx="38%" cy="36%" r="70%">
            <stop offset="0%" stopColor="#fff7c8" />
            <stop offset="45%" stopColor="#ffd15a" />
            <stop offset="100%" stopColor="#ff9a2e" />
          </radialGradient>
          {reducedMotion ? null : (
            <filter id={heatId} x="-35%" y="-35%" width="170%" height="170%">
              <feTurbulence type="turbulence" baseFrequency="0.012" numOctaves="2" seed="4" result="noise">
                <animate attributeName="baseFrequency" values="0.01;0.02;0.01" dur="6s" repeatCount="indefinite" />
              </feTurbulence>
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          )}
        </defs>
        <g filter={reducedMotion ? undefined : `url(#${heatId})`}>
          <g className="journey-spin">
            {Array.from({ length: 12 }, (_, index) => (
              <rect key={index} x="56" y="4" width="8" height="22" rx="4" fill="#ffe08a" transform={`rotate(${index * 30} 60 60)`} />
            ))}
          </g>
          <circle cx="60" cy="60" r="28" fill={`url(#${heatId}-sun)`} stroke="#fff4c4" strokeWidth="3" />
        </g>
      </svg>
      <button type="button" className="journey-chip absolute left-3 top-3 z-20 px-3 py-2 text-xs font-bold" onClick={onBack}>
        返回
      </button>
      <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
        <div className="journey-plaque px-5 py-2 text-lg font-black">星藤航图</div>
      </div>
      <div
        className="absolute inset-x-0 bottom-[18%] top-16 z-10"
        style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}
      >
        <button
          type="button"
          className="journey-tree-hover absolute left-1/2 top-1/2 h-[min(62dvh,560px)] w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2"
          onClick={onStart}
          aria-label="点击大树 开始今日航线"
        >
          <span className="journey-sway block h-full w-full">
            <svg viewBox="0 0 400 520" className="h-full w-full" aria-hidden="true">
              <ellipse cx="200" cy="490" rx="120" ry="18" fill="rgba(40,80,20,0.18)" />
              <path d="M176 470 C168 360 170 300 188 250 L214 250 C232 300 234 360 224 470 Z" fill="#8d5a32" stroke="#6b3e12" strokeWidth="3" />
              <path d="M196 460 C198 360 200 300 204 260" fill="none" stroke="#c48955" strokeWidth="6" strokeLinecap="round" />
              <g className="journey-leaf" style={{ animationDelay: '0.2s' }}>
                <ellipse cx="150" cy="230" rx="78" ry="64" fill="#3fa84a" />
                <ellipse cx="132" cy="210" rx="28" ry="16" fill="white" opacity="0.28" />
              </g>
              <g className="journey-leaf" style={{ animationDelay: '0.8s' }}>
                <ellipse cx="250" cy="220" rx="84" ry="70" fill="#67c85a" />
                <ellipse cx="270" cy="198" rx="26" ry="14" fill="white" opacity="0.32" />
              </g>
              <g className="journey-leaf">
                <ellipse cx="200" cy="180" rx="96" ry="78" fill="#8ed957" />
                <ellipse cx="176" cy="156" rx="34" ry="16" fill="white" opacity="0.4" />
              </g>
              <g className="journey-leaf" style={{ animationDelay: '1.2s' }}>
                <ellipse cx="120" cy="280" rx="48" ry="36" fill="#2f9a45" />
              </g>
              <g className="journey-leaf" style={{ animationDelay: '0.4s' }}>
                <ellipse cx="286" cy="286" rx="52" ry="38" fill="#b6f07a" />
              </g>
            </svg>
            {fruits.map((fruit, index) => {
              const slot = FRUIT_SLOTS[index];
              if (!slot) return null;
              return (
                <span key={fruit.date} className="absolute block h-11 w-11" style={slot}>
                  <FruitGlyph color={fruit.color} kind={fruit.kind} cleared={fruit.cleared} />
                </span>
              );
            })}
          </span>
        </button>
        <div className="journey-sign absolute bottom-2 left-[8%] px-3 py-2 text-sm font-bold leading-6">
          <div>{streakDays === null ? '连续打卡 —' : `连续打卡 ${streakDays} 天`}</div>
          <div>{weekStars === null ? '本周 — ★' : `本周 ${weekStars} ★`}</div>
        </div>
      </div>
      <div className="journey-ripple" />
      <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center px-4 pb-[env(safe-area-inset-bottom)]">
        <button type="button" className="journey-pill px-5 py-3 text-base font-black" onClick={onStart}>
          点击大树 开始今日航线
        </button>
      </div>
    </div>
  );
}
