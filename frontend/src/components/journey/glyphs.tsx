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
  const gid = useId();
  if (kind === 'bud') {
    return (
      <svg viewBox="0 0 80 80" className="h-full w-full" aria-hidden="true">
        <path d="M40 18 q2 10 -6 16" fill="none" stroke="#3d9a45" strokeWidth="3" strokeLinecap="round" />
        <ellipse cx="40" cy="48" rx="16" ry="18" fill="#d9f5c4" stroke="#7dce55" strokeWidth="2" />
        <path d="M40 34 q10 8 8 18 q-8 -2 -8 6 q-10 -8 -8 -18 q8 2 8 -6 z" fill="#fff4fb" stroke="#f3b7d8" strokeWidth="1.4" />
      </svg>
    );
  }
  if (kind === 'sprout') {
    return (
      <svg viewBox="0 0 80 80" className="h-full w-full" aria-hidden="true">
        <path d="M40 58 V36" stroke="#3d9a45" strokeWidth="3" strokeLinecap="round" />
        <path d="M40 42 C28 40 22 30 24 24 C34 26 40 34 40 42" fill="#8ed957" />
        <path d="M40 40 C52 34 60 26 58 20 C48 24 42 32 40 40" fill="#c6f58a" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 80 80" className="h-full w-full" aria-hidden="true">
      <defs>
        <radialGradient id={gid} cx="35%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#fffef4" />
          <stop offset="28%" stopColor={stops[0]} />
          <stop offset="62%" stopColor={stops[1]} />
          <stop offset="100%" stopColor={stops[2]} />
        </radialGradient>
      </defs>
      {cleared ? <circle cx="40" cy="46" r="30" fill="none" stroke="#ffe08a" strokeWidth="3" /> : null}
      <path d="M40 16 q3 8 -4 14" fill="none" stroke="#2f8a3a" strokeWidth="2.4" strokeLinecap="round" />
      <ellipse cx="48" cy="20" rx="8" ry="4" transform="rotate(30 48 20)" fill="#8ed957" />
      <ellipse cx="40" cy="48" rx="22" ry="20" fill={`url(#${gid})`} stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
      <ellipse cx="32" cy="40" rx="8" ry="5" fill="white" opacity={color === 'gray' ? 0.35 : 0.62} />
    </svg>
  );
}

const CROWN = [
  { x: 12, y: 18, size: 14, rot: -15 },
  { x: 30, y: 10, size: 18, rot: -4 },
  { x: 52, y: 10, size: 18, rot: 4 },
  { x: 70, y: 18, size: 14, rot: 15 },
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
  const gid = useId();
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
