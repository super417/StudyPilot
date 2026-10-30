import type { CharacterMode } from './assistantCharacter';

export const CHARACTER_VIDEOS = {
  main: '/assistant/ningning/master-main.mp4',
  hover: '/assistant/ningning/master-hover.mp4',
  chinExit: '/assistant/ningning/exit-chin-to-idle.mp4',
  thinkingExit: '/assistant/ningning/exit-thinking-to-idle.mp4',
} as const;

export type VideoPose = 'idle' | 'hover' | 'open' | 'thinking';
export interface CharacterSegment {
  video: keyof typeof CHARACTER_VIDEOS;
  start: number;
  end: number;
  pose: VideoPose;
  hold?: CharacterMode;
  finish?: 'answer' | 'entrance';
}

// Measured from the delivered 24fps clips, not the generation brief.
const sit: CharacterSegment = { video: 'main', start: .55, end: 2.4, pose: 'open' };
const standAndThink: CharacterSegment = { video: 'main', start: 4.55, end: 6.4, pose: 'thinking' };
const exits: Record<Exclude<VideoPose, 'idle'>, CharacterSegment> = {
  hover: { video: 'hover', start: 4.55, end: 7.65, pose: 'idle' },
  open: { video: 'chinExit', start: 0, end: 2.95, pose: 'idle' },
  thinking: { video: 'thinkingExit', start: 0, end: 1.95, pose: 'idle' },
};

/** Choose one continuous transition, then recheck the latest chat event. */
export function nextCharacterSegment(pose: VideoPose, mode: CharacterMode): CharacterSegment {
  if (mode === 'entrance') return { video: 'main', start: 9.8, end: 13.4, pose: 'idle', finish: mode };
  if (mode === 'answer' && pose === 'thinking') return { video: 'main', start: 9.25, end: 13.4, pose: 'idle', finish: mode };
  const target = mode === 'answer' ? 'thinking' : mode;
  if (pose === target) {
    const holds: Record<VideoPose, CharacterSegment> = {
      idle: { video: 'main', start: 13.45, end: 14.9, pose, hold: mode },
      hover: { video: 'hover', start: 2.65, end: 4.45, pose, hold: mode },
      open: { video: 'main', start: 2.45, end: 4.45, pose, hold: mode },
      thinking: { video: 'main', start: 6.45, end: 9.15, pose, hold: mode },
    };
    return holds[pose];
  }
  if (pose === 'open' && target === 'thinking') return standAndThink;
  if (pose !== 'idle') return exits[pose];
  if (target === 'hover') return { video: 'hover', start: .55, end: 2.65, pose: 'hover' };
  return sit;
}

/** Key only green chroma. White/pink shoes and neutral highlights stay opaque. */
export function clearAssistantGreenScreen(pixels: Pick<ImageData, 'data'>) {
  const { data } = pixels;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const green = g - Math.max(r, b);
    if (green <= 18 || g < 65) continue;
    const opacity = 1 - Math.min(1, (green - 18) / 64);
    data[i + 3] = Math.round(data[i + 3] * opacity);
    // Despill the partially transparent boundary, without tinting the shoes.
    data[i + 1] = Math.min(g, Math.max(r, b) + 12);
  }
}
