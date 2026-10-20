import { useId } from 'react';

/** 未到日期的灯笼果。自绘青柠花苞，不使用参考截图像素。 */
export function LanternFruit({ size = 62, flip = 1 }: { size?: number; flip?: number }) {
  const raw = useId().replace(/:/g, '');
  const body = `fruit-body-${raw}`;
  const glow = `fruit-glow-${raw}`;
  const height = Math.round(size * 1.15);
  return (
    <span className="lantern-fruit-future" style={{ width: size, height }} aria-hidden="true">
      <svg viewBox="0 0 64 76" width={size} height={height}>
        <defs>
          <radialGradient id={body} cx="38%" cy="42%" r="58%">
            <stop offset="0%" stopColor="#EEFBAF" />
            <stop offset="28%" stopColor="#D4F260" />
            <stop offset="48%" stopColor="#BBEB52" />
            <stop offset="76%" stopColor="#88D137" />
            <stop offset="100%" stopColor="#68C024" />
          </radialGradient>
          <radialGradient id={glow} cx="50%" cy="55%" r="50%">
            <stop offset="35%" stopColor="rgba(200,242,74,0.5)" />
            <stop offset="100%" stopColor="rgba(200,242,74,0)" />
          </radialGradient>
        </defs>
        <ellipse cx="32" cy="46" rx="30" ry="32" fill={`url(#${glow})`} />
        <path
          d={flip < 0 ? 'M58 6 C50 16 42 14 32 18' : 'M6 6 C14 16 22 14 32 18'}
          fill="none"
          stroke="#4CAF1E"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <path
          d="M32 20 C46 20 54 34 52 48 C50 62 41 70 32 72 C23 70 14 62 12 48 C10 34 18 20 32 20 Z"
          fill={`url(#${body})`}
        />
        <path d="M28 28 C30 48 30 60 32 68" fill="none" stroke="#68C024" strokeOpacity="0.12" strokeWidth="2" />
        <path d="M36 30 C34 48 34 58 33 66" fill="none" stroke="#68C024" strokeOpacity="0.1" strokeWidth="1.5" />
        <ellipse cx="24" cy="40" rx="8" ry="11" fill="rgba(238,251,175,0.72)" />
        <ellipse cx="22" cy="36" rx="3.2" ry="4.2" fill="#EEFBAF" />
        <path d="M32 22 C28 14 26 8 32 3 C38 8 36 14 32 22 Z" fill="#2A8C0A" />
        <path d="M24 24 C18 16 14 12 20 8 C26 14 28 18 28 24 Z" fill="#34961A" />
        <path d="M40 24 C46 16 50 12 44 8 C38 14 36 18 36 24 Z" fill="#34961A" />
        <path d="M32 20 C30 12 29 7 32 2 C35 7 34 12 32 20 Z" fill="#1F6E08" />
        <circle cx="14" cy="30" r="1.3" fill="#F5FFC8" opacity="0.55" />
        <circle cx="50" cy="26" r="1.1" fill="#F5FFC8" opacity="0.4" />
        <circle cx="46" cy="62" r="1.2" fill="#F5FFC8" opacity="0.35" />
      </svg>
    </span>
  );
}
