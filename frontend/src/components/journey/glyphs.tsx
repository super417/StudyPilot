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
      <rect x="6" y="8" width="52" height="52" rx="16" fill="#f4ffe8" stroke="#7dce55" strokeWidth="3" />
      <path d="M24 18 C20 8 14 8 14 14 C18 16 22 18 24 24" fill="#7dce45" />
      <path d="M40 18 C44 8 50 8 50 14 C46 16 42 18 40 24" fill="#b6f07a" />
      <path d="M18 24 h28 a10 10 0 0 1 10 8 v3 H18 z" fill="#e7c56a" stroke="#b8892e" strokeWidth="1.4" />
      <path d="M22 24 h20 v-4 a6 6 0 0 0 -6 -6 h-8 a6 6 0 0 0 -6 6 z" fill="#f3d48a" />
      <circle cx="32" cy="16" r="6" fill="#ffe56a" stroke="#e0a82e" strokeWidth="1" />
      <path d={starPath(32, 16, 3.4, 1.4)} fill="#fff8d0" />
      <circle cx="32" cy="40" r="14" fill="#d9f5b8" stroke="#6bb84a" strokeWidth="1.4" />
      <ellipse cx="26.5" cy="39" rx="3.2" ry="3.6" fill="#243126" />
      <ellipse cx="37.5" cy="39" rx="3.2" ry="3.6" fill="#243126" />
      <circle cx="27.4" cy="37.8" r="1.1" fill="white" />
      <circle cx="38.4" cy="37.8" r="1.1" fill="white" />
      <path d="M28 46 q4 3 8 0" fill="none" stroke="#e07a88" strokeWidth="1.5" strokeLinecap="round" />
      <ellipse cx="23" cy="43" rx="2.4" ry="1.4" fill="#f3b7c4" />
      <ellipse cx="41" cy="43" rx="2.4" ry="1.4" fill="#f3b7c4" />
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
        <path d="M40 18 q2 14 -6 22" fill="none" stroke="#2f8a3a" strokeWidth="3" strokeLinecap="round" />
        <ellipse cx="46" cy="22" rx="10" ry="5" transform="rotate(28 46 22)" fill="#8ed957" stroke="#2f8a3a" strokeWidth="1" />
        <path d="M40 34 C52 36 58 48 54 60 C48 68 32 68 26 60 C22 48 28 36 40 34 Z" fill="#c8efb0" stroke="#3d9a45" strokeWidth="2" />
        <path d="M40 36 C46 44 46 54 40 62 C34 54 34 44 40 36 Z" fill="#8ed957" />
        <ellipse cx="34" cy="48" rx="4" ry="7" fill="white" opacity="0.45" />
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
      {cleared ? <circle cx="40" cy="46" r="30" fill="none" stroke="#ffe08a" strokeWidth="3" /> : null}
      <path d="M40 12 q4 8 -4 14" fill="none" stroke="#2f8a3a" strokeWidth="2.6" strokeLinecap="round" />
      <ellipse cx="50" cy="16" rx="10" ry="4.4" transform="rotate(28 50 16)" fill={gray ? '#c5d0c0' : '#8ed957'} stroke="#2f8a3a" strokeWidth="0.8" />
      <ellipse cx="40" cy="46" rx={rx} ry={ry} fill={`url(#${gid})`} stroke={gray ? '#b7bdc8' : '#fff'} strokeWidth={gray ? 1.4 : 2.4} />
      {!gray ? <ellipse cx="40" cy="46" rx={rx - 4} ry={ry - 4} fill="none" stroke="white" strokeWidth="1.2" opacity="0.35" /> : null}
      {warm ? <ellipse cx="48" cy="54" rx="7" ry="4" fill="#ff8a3d" opacity="0.35" /> : null}
      {cool ? <ellipse cx="46" cy="56" rx="5" ry="3" fill="#6f7cff" opacity="0.35" /> : null}
      {ripe ? <path d={starPath(58, 28, 4.2, 1.7)} fill="#fff6c2" stroke="#ffe08a" strokeWidth="0.6" /> : null}
      <ellipse cx="31" cy="38" rx={gray ? 4 : 9} ry={gray ? 2.4 : 6} fill="white" opacity={gray ? 0.2 : 0.85} />
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
            fill={on ? `url(#${gid})` : 'rgba(255,255,255,0.28)'}
            stroke={on ? '#fff8d8' : 'rgba(255,255,255,0.85)'}
            strokeWidth={on ? 1.3 : 1.2}
            strokeDasharray={preview && !on ? '2 1.6' : undefined}
            opacity={on ? 1 : 0.45}
          />
        );
      })}
    </svg>
  );
}
