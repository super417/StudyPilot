import { useId } from 'react';

import type { StarColor } from '@/journey/stars';

/**
 * 已过关 / 空白日的豆荚铃铛果：顶部绿色果蒂叶，果身柔和粉彩渐变、水晶高光，底部三瓣小圆裙。
 * 自绘 SVG，风格和未到日期的 LanternFruit 一致。
 */
const PALETTES: Record<StarColor | 'unripe', [string, string, string, string]> = {
  vivid: ['#FFE6F5', '#F7B9E6', '#B9C6FF', '#A4ECF2'],
  warm: ['#FFF3DC', '#FFD2AE', '#FFB2C0', '#FFC8D8'],
  cool: ['#EEF3FF', '#C3CEFF', '#C9B6F6', '#B3E0FF'],
  muted: ['#F6F1FC', '#DED2F1', '#CBD9EE', '#E4DDF4'],
  gray: ['#E4F0D4', '#CBE0B2', '#B2CF98', '#C6DDAE'],
  unripe: ['#E4F0D4', '#CBE0B2', '#B2CF98', '#C6DDAE'],
};

export function PodFruit({ color, size = 52, unripe = false }: { color: StarColor | null; size?: number; unripe?: boolean }) {
  const raw = useId().replace(/:/g, '');
  const body = `pod-body-${raw}`;
  const shine = `pod-shine-${raw}`;
  const key = unripe ? 'unripe' : color ?? 'muted';
  const [c0, c1, c2, c3] = PALETTES[key];
  const height = Math.round(size * 1.18);
  return (
    <span className={`pod-fruit ${unripe ? 'is-unripe' : ''}`} style={{ width: size, height }} aria-hidden="true">
      <svg viewBox="0 0 64 76" width={size} height={height}>
        <defs>
          <linearGradient id={body} x1="0.15" y1="0.1" x2="0.85" y2="0.95">
            <stop offset="0%" stopColor={c0} />
            <stop offset="38%" stopColor={c1} />
            <stop offset="72%" stopColor={c2} />
            <stop offset="100%" stopColor={c3} />
          </linearGradient>
          <radialGradient id={shine} cx="34%" cy="34%" r="40%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* 果身：上窄下圆的铃铛，底部三瓣 */}
        <path
          d="M32 17 C44 17 51 25 53 35 C55 44 58 51 58 58 C58 64 54 67 50 65 C48 70 43 71 40 67 C37 72 27 72 24 67 C21 71 16 70 14 65 C10 67 6 64 6 58 C6 51 9 44 11 35 C13 25 20 17 32 17 Z"
          fill={`url(#${body})`}
          stroke="#ffffff"
          strokeOpacity="0.85"
          strokeWidth="1.6"
        />
        <ellipse cx="30" cy="44" rx="20" ry="22" fill={`url(#${shine})`} />
        <path d="M21 32 C17 40 14 48 14 57" fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="2.6" strokeLinecap="round" />
        <ellipse cx="24" cy="30" rx="2.6" ry="3.8" fill="#ffffff" opacity="0.95" />
        <path d="M48 60 C50 55 49 50 46 45" fill="none" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="1.6" strokeLinecap="round" />
        {/* 果蒂：两片叶 + 中间小蒂 */}
        <path d="M32 24 C22 27 12 25 7 17 C16 13 26 15 32 21 Z" fill="#5DBB2A" />
        <path d="M32 24 C42 27 52 25 57 17 C48 13 38 15 32 21 Z" fill="#4AAA1F" />
        <path d="M32 26 C27 30 21 31 17 29 C21 24 27 22 32 22 Z" fill="#3E9E1A" />
        <path d="M32 26 C37 30 43 31 47 29 C43 24 37 22 32 22 Z" fill="#358F14" />
        <path d="M32 22 C28 18 27 10 31 3 C35 8 35 15 32 22 Z" fill="#2F8A12" />
        <path d="M12 17 C19 16 26 18 30 21" fill="none" stroke="#B8EA7C" strokeOpacity="0.8" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    </span>
  );
}
