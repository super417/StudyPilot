import { useState, type MouseEvent } from 'react';

import cloud from '@/assets/journey/cloud.webp';
import flowers from '@/assets/journey/flowers.webp';
import hill from '@/assets/journey/hill.webp';
import leaf from '@/assets/journey/leaf.webp';
import sky from '@/assets/journey/sky.webp';
import star from '@/assets/journey/star.webp';
import sun from '@/assets/journey/sun.webp';
import tree from '@/assets/journey/tree.webp';
import wind from '@/assets/journey/wind.webp';
import wood from '@/assets/journey/wood.webp';
import { FruitGlyph, StarCrown } from '@/components/journey/glyphs';
import type { StarColor } from '@/journey/stars';

export interface EntranceFruit {
  date: string;
  color: StarColor | null;
  kind: 'fruit' | 'bud' | 'sprout';
  cleared: boolean;
}

const FRUIT_SLOTS = [
  { left: '14%', top: '28%' },
  { left: '30%', top: '16%' },
  { left: '48%', top: '8%' },
  { left: '66%', top: '14%' },
  { left: '78%', top: '30%' },
  { left: '24%', top: '44%' },
  { left: '58%', top: '42%' },
];

const FALLING = [
  { left: '12%', delay: '0s', duration: '12s', width: 22 },
  { left: '28%', delay: '2s', duration: '10s', width: 18 },
  { left: '46%', delay: '4.5s', duration: '13s', width: 26 },
  { left: '68%', delay: '1s', duration: '11s', width: 16 },
  { left: '84%', delay: '3.2s', duration: '9s', width: 20 },
];

const CANOPY_LEAVES = [
  { left: '18%', top: '18%', width: 36, delay: '0.2s' },
  { left: '62%', top: '12%', width: 42, delay: '0.8s' },
  { left: '74%', top: '28%', width: 30, delay: '1.3s' },
];

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
      <img src={sky} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      <img
        src={cloud}
        alt=""
        draggable={false}
        className="journey-drift pointer-events-none absolute left-[2%] top-[7%] w-[min(28vw,240px)]"
      />
      <img
        src={cloud}
        alt=""
        draggable={false}
        className="journey-drift pointer-events-none absolute left-[34%] top-[3%] w-[min(32vw,280px)]"
        style={{ animationDelay: '-6s' }}
      />
      <img
        src={cloud}
        alt=""
        draggable={false}
        className="journey-drift pointer-events-none absolute left-[58%] top-[18%] w-[min(22vw,180px)]"
        style={{ animationDelay: '-11s' }}
      />
      <img
        src={sun}
        alt=""
        draggable={false}
        className="pointer-events-none absolute right-0 top-0 z-[1] w-[45.5%]"
      />
      {FALLING.map((item) => (
        <span
          key={item.left}
          className="journey-fall pointer-events-none absolute top-0"
          style={{ left: item.left, animationDelay: item.delay, animationDuration: item.duration }}
        >
          <img src={leaf} alt="" draggable={false} style={{ width: item.width }} />
        </span>
      ))}
      <button type="button" className="journey-chip absolute left-3 top-3 z-30 px-3 py-2 text-xs font-bold" onClick={onBack}>
        返回
      </button>
      <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center px-16">
        <div className="journey-plaque flex items-center gap-3 px-8 py-3 text-2xl font-black sm:text-3xl">
          <img src={star} alt="" draggable={false} className="h-8 w-8 object-contain" />
          星藤航图
          <img src={star} alt="" draggable={false} className="h-8 w-8 object-contain" />
        </div>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-[-6%] z-[6]"
        style={{
          bottom: 0,
          height: compact ? '24%' : '22%',
          background:
            'radial-gradient(ellipse 62% 78% at 50% 100%, #9adf62 0%, #67bc48 36%, #4e9d3c 62%, rgba(78,157,60,0) 74%)',
        }}
      />
      <div
        className="absolute inset-x-0 z-10"
        style={{
          transform: `translate(${shift.x}px, ${shift.y}px)`,
          top: compact ? 18 : 36,
          bottom: compact ? 78 : 96,
        }}
      >
        <button
          type="button"
          className="journey-tree-hover journey-tree-fit absolute inset-0 flex items-end justify-center"
          onClick={onStart}
          aria-label="点击大树 开始今日航线"
        >
          <span className="journey-sway journey-tree-box relative block">
            <img src={tree} alt="" draggable={false} className="h-full w-full object-contain object-bottom" />
            <img src={wind} alt="" draggable={false} className="pointer-events-none absolute left-[6%] top-[4%] w-[88%] opacity-90" />
            {CANOPY_LEAVES.map((item) => (
              <img
                key={item.left}
                src={leaf}
                alt=""
                draggable={false}
                className="journey-leaf pointer-events-none absolute"
                style={{ left: item.left, top: item.top, width: item.width, animationDelay: item.delay }}
              />
            ))}
            {fruits.map((fruit, index) => {
              const slot = FRUIT_SLOTS[index];
              if (!slot) return null;
              return (
                <span key={fruit.date} className="absolute block h-20 w-20" style={slot}>
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <StarCrown filled={fruit.cleared ? 4 : 3} color={fruit.color} preview={false} compact={false} />
                  </span>
                  <FruitGlyph color="vivid" kind={fruit.kind === 'bud' ? 'fruit' : fruit.kind} cleared={fruit.cleared} />
                </span>
              );
            })}
            {compact ? null : (
              <div className="absolute bottom-[14%] left-[54%] w-[148px] -translate-x-1/2">
                <img src={wood} alt="" draggable={false} className="w-full" />
                <div className="absolute inset-y-[22%] left-[28%] right-[8%] flex flex-col items-center justify-center text-center text-[10px] font-black leading-3 text-[#5a3412]">
                  {sign}
                </div>
              </div>
            )}
          </span>
        </button>
      </div>
      <img
        src={hill}
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[12] w-full object-cover object-top"
        style={{ height: compact ? '18%' : '16%' }}
      />
      <img
        src={flowers}
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[15] w-full object-cover object-bottom"
      />
      <div className="journey-ripple" />
      <div className="absolute inset-x-0 bottom-3 z-20 flex items-end justify-center gap-3 px-3 pb-[env(safe-area-inset-bottom)]">
        {compact ? (
          <div className="journey-sign px-3 py-1.5 text-center text-xs font-black leading-5">{sign}</div>
        ) : null}
        <button type="button" className="journey-cta min-w-[240px] px-10 py-4 text-xl font-black" onClick={onStart}>
          点击大树 开始今日航线
        </button>
      </div>
    </div>
  );
}
