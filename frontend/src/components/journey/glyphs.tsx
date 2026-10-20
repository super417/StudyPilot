import bud from '@/assets/journey/bud.webp';
import fruitCool from '@/assets/journey/fruit-cool.webp';
import fruitGray from '@/assets/journey/fruit-gray.webp';
import fruitMuted from '@/assets/journey/fruit-muted.webp';
import fruitVivid from '@/assets/journey/fruit-vivid.webp';
import fruitWarm from '@/assets/journey/fruit-warm.webp';
import leaf from '@/assets/journey/leaf.webp';
import sprout from '@/assets/journey/sprout.webp';
import star from '@/assets/journey/star.webp';
import type { StarColor } from '@/journey/stars';

const FRUIT_SRC: Record<StarColor, string> = {
  vivid: fruitVivid,
  warm: fruitWarm,
  cool: fruitCool,
  muted: fruitMuted,
  gray: fruitGray,
};

export function SproutAvatar({ size = 54 }: { size?: number }) {
  return (
    <img
      src={sprout}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className="pointer-events-none object-contain"
    />
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
  if (kind === 'sprout') {
    return (
      <span className="relative block h-full w-full" aria-hidden="true">
        <img src={leaf} alt="" draggable={false} className="absolute left-[6%] top-[22%] w-[62%] -rotate-[38deg]" />
        <img src={leaf} alt="" draggable={false} className="absolute right-[4%] top-[30%] w-[62%] rotate-[32deg]" />
      </span>
    );
  }
  const src = kind === 'bud' ? bud : FRUIT_SRC[color ?? 'gray'];
  return (
    <span className="relative block h-full w-full" aria-hidden="true">
      {cleared ? <span className="absolute inset-[-6%] rounded-full border-2 border-[#ffe08a]" /> : null}
      <img src={src} alt="" draggable={false} className="h-full w-full object-contain" />
    </span>
  );
}

export function LeafMark({ flip = 1, size = 34 }: { flip?: number; size?: number }) {
  return (
    <img
      src={leaf}
      alt=""
      draggable={false}
      width={size}
      style={{ width: size, height: 'auto', transform: `scaleX(${flip})` }}
    />
  );
}

const CROWN = [
  { left: 0, top: 4, size: 18, rot: -15 },
  { left: 22, top: 0, size: 24, rot: -4 },
  { left: 50, top: 0, size: 24, rot: 4 },
  { left: 78, top: 4, size: 18, rot: 15 },
];

export function StarCrown({
  filled,
  preview,
  compact,
}: {
  filled: number;
  color: StarColor | null;
  preview: boolean;
  compact: boolean;
}) {
  const scale = compact ? 0.78 : 1;
  return (
    <span className="relative block" style={{ width: 98 * scale, height: 30 * scale }} aria-hidden="true">
      {CROWN.map((slot, index) => {
        const on = index < filled;
        return (
          <img
            key={slot.left}
            src={star}
            alt=""
            draggable={false}
            className="absolute object-contain"
            style={{
              left: slot.left * scale,
              top: slot.top * scale,
              width: slot.size * scale,
              height: slot.size * scale,
              transform: `rotate(${slot.rot}deg)`,
              opacity: on ? 1 : preview ? 0.45 : 0.3,
            }}
          />
        );
      })}
    </span>
  );
}
