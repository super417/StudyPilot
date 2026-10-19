import { useId } from 'react';

import type { StarColor } from '@/journey/stars';

export const FRUIT_STOPS: Record<StarColor, [string, string, string]> = {
  vivid: ['#ff8ad4', '#ffe56a', '#7af0c6'],
  warm: ['#ffe27a', '#ffb347', '#b6f07a'],
  cool: ['#8fd8ff', '#9aa6ff', '#e3c6ff'],
  muted: ['#d7c6e4', '#b7c0d8', '#efe6f6'],
  gray: ['#e6e8ee', '#c5cad3', '#f7f8fb'],
};

export function starPath(cx: number, cy: number, outer: number, inner: number): string {
  const points: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M ${points.join(' L ')} Z`;
}

export function SproutAvatar({ size = 54 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="58" rx="14" ry="4" fill="rgba(20,60,20,0.18)" />
      <path d="M32 30 C28 18 18 16 16 22 C22 24 28 28 32 34" fill="#7dce45" />
      <path d="M32 30 C36 16 48 14 50 22 C42 24 36 28 32 34" fill="#b6f07a" />
      <path d="M18 16 l6 2 -4 5 z" fill="#e7c56a" />
      <path d="M14 20 h22 a8 8 0 0 1 8 8 v2 H14 z" fill="#f0d48a" stroke="#c4923a" strokeWidth="1.4" />
      <circle cx="36" cy="18" r="5" fill="#ffe56a" stroke="#e0a82e" strokeWidth="1" />
      <path d="M36 15.2 l.9 1.8 2 .3 -1.45 1.4.35 2 -1.8-.9 -1.8.9.35-2 -1.45-1.4 2-.3 z" fill="#fff8d0" />
      <circle cx="32" cy="40" r="14" fill="#e7f8c8" stroke="#7dae45" strokeWidth="1.6" />
      <circle cx="27" cy="39" r="2.1" fill="#243126" />
      <circle cx="37" cy="39" r="2.1" fill="#243126" />
      <circle cx="27.7" cy="38.3" r="0.7" fill="white" />
      <circle cx="37.7" cy="38.3" r="0.7" fill="white" />
      <path d="M28 45 q4 3 8 0" fill="none" stroke="#d36b7b" strokeWidth="1.4" strokeLinecap="round" />
      <ellipse cx="24" cy="43" rx="2.2" ry="1.2" fill="#f3b7c4" opacity="0.8" />
      <ellipse cx="40" cy="43" rx="2.2" ry="1.2" fill="#f3b7c4" opacity="0.8" />
    </svg>
  );
}

export function FruitGlyph({
  color,
  kind,
  cleared,
}: {
  color: StarColor | null;
  kind: 'fruit' | 'bud' | 'sprout';
  cleared: boolean;
}) {
  const stops = FRUIT_STOPS[color ?? 'gray'];
  const gid = useId().replace(/:/g, '');
  if (kind === 'bud') {
    return (
      <svg viewBox="0 0 80 80" className="h-full w-full" aria-hidden="true">
        <path d="M40 16 q2 12 -8 20" fill="none" stroke="#2f8a3a" strokeWidth="3" strokeLinecap="round" />
        <ellipse cx="34" cy="22" rx="9" ry="4" transform="rotate(-30 34 22)" fill="#9be36a" stroke="#3d9a45" strokeWidth="1" />
        <ellipse cx="40" cy="50" rx="14" ry="18" fill="#c8efb0" stroke="#5cb84a" strokeWidth="2" />
        <path d="M40 36 c8 4 12 12 8 20 c-6 -2 -8 2 -8 8 c-6 -6 -10 -12 -8 -20 c4 2 6 -4 8 -8 z" fill="#ffe4f2" stroke="#f0a8cc" strokeWidth="1.3" />
        <ellipse cx="36" cy="44" rx="3" ry="5" fill="white" opacity="0.55" />
      </svg>
    );
  }
  if (kind === 'sprout') {
    return (
      <svg viewBox="0 0 80 80" className="h-full w-full" aria-hidden="true">
        <path d="M40 62 V34" stroke="#2f8a3a" strokeWidth="3.2" strokeLinecap="round" />
        <path d="M40 44 C26 42 18 30 20 22 C32 24 40 34 40 44" fill="#7ed957" stroke="#3d9a45" strokeWidth="1" />
        <path d="M40 42 C54 34 64 24 62 16 C50 20 42 32 40 42" fill="#d4f7a4" stroke="#6bb84a" strokeWidth="1" />
        <ellipse cx="28" cy="30" rx="3" ry="1.6" fill="white" opacity="0.7" />
      </svg>
    );
  }
  const ripe = color === 'vivid';
  const warm = color === 'warm';
  const cool = color === 'cool';
  const gray = color === 'gray' || color === null;
  const rx = cool ? 18 : gray ? 19 : ripe ? 23 : 21;
  const ry = cool ? 24 : color === 'muted' ? 16 : gray ? 18 : 21;
  return (
    <svg viewBox="0 0 80 80" className="h-full w-full" aria-hidden="true">
      <defs>
        <radialGradient id={gid} cx="34%" cy="30%" r="72%">
          <stop offset="0%" stopColor={gray ? '#f4f5f8' : '#fffef6'} />
          <stop offset="22%" stopColor={stops[0]} />
          <stop offset="58%" stopColor={stops[1]} />
          <stop offset="100%" stopColor={stops[2]} />
        </radialGradient>
      </defs>
      {cleared ? <circle cx="40" cy="48" r="31" fill="none" stroke="#ffe08a" strokeWidth="3" /> : null}
      <path d="M40 14 q4 8 -5 16" fill="none" stroke="#2f8a3a" strokeWidth="2.6" strokeLinecap="round" />
      <ellipse cx="50" cy="18" rx="9" ry="4.2" transform="rotate(28 50 18)" fill={gray ? '#c5d0c0' : '#8ed957'} stroke="#3d9a45" strokeWidth="0.8" />
      <ellipse cx="40" cy="48" rx={rx} ry={ry} fill={`url(#${gid})`} stroke={gray ? '#b7bdc8' : 'rgba(255,255,255,0.85)'} strokeWidth="1.6" />
      {warm ? <ellipse cx="48" cy="56" rx="7" ry="4" fill="#ff8a3d" opacity="0.35" /> : null}
      {cool ? <ellipse cx="46" cy="58" rx="5" ry="3" fill="#6f7cff" opacity="0.35" /> : null}
      {ripe ? <path d={starPath(58, 30, 4, 1.6)} fill="#fff6c2" /> : null}
      <ellipse cx="31" cy="40" rx={gray ? 5 : 8} ry={gray ? 3 : 5} fill="white" opacity={gray ? 0.16 : color === 'muted' ? 0.32 : 0.7} />
    </svg>
  );
}

export function LeafMark({ flip = 1, size = 34 }: { flip?: number; size?: number }) {
  return (
    <svg width={size} height={size * 0.62} viewBox="0 0 34 21" aria-hidden="true" style={{ transform: `scaleX(${flip})` }}>
      <path d="M2 11 C8 2 20 1 32 10 C22 19 10 20 2 11 Z" fill="#5dce62" stroke="#1f8a3c" strokeWidth="1.2" />
      <path d="M8 11 C14 6 22 6 28 11 C22 15 14 15 8 11 Z" fill="#b6f07a" />
      <path d="M6 11 H26" stroke="#f4ffe8" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

const CROWN = [
  { x: 12, y: 14, size: 14, rot: -15 },
  { x: 30, y: 10, size: 18, rot: -4 },
  { x: 52, y: 10, size: 18, rot: 4 },
  { x: 70, y: 14, size: 14, rot: 15 },
];

export function StarCrown({
  filled,
  color,
  preview,
  compact,
}: {
  filled: number;
  color: StarColor | null;
  preview: boolean;
  compact: boolean;
}) {
  const stops = FRUIT_STOPS[color ?? 'gray'];
  const scale = compact ? 0.78 : 1;
  const gid = useId().replace(/:/g, '');
  return (
    <svg width={84 * scale} height={32 * scale} viewBox="0 0 84 32" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={stops[0]} />
          <stop offset="50%" stopColor={stops[1]} />
          <stop offset="100%" stopColor={stops[2]} />
        </linearGradient>
      </defs>
      {CROWN.map((slot, index) => {
        const on = index < filled;
        const path = starPath(slot.x, slot.y, slot.size / 2, slot.size / 5.2);
        return (
          <path
            key={slot.x}
            d={path}
            transform={`rotate(${slot.rot} ${slot.x} ${slot.y})`}
            fill={on ? `url(#${gid})` : 'transparent'}
            stroke={on ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.8)'}
            strokeWidth={on ? 1 : 1.4}
            strokeDasharray={preview && !on ? '2 1.6' : undefined}
            opacity={on ? 1 : 0.45}
          />
        );
      })}
    </svg>
  );
}
