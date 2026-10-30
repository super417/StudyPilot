export type CharacterMode = 'idle' | 'hover' | 'open' | 'thinking' | 'answer' | 'entrance';

export const CHARACTER_IMAGES: Record<CharacterMode, string> = {
  idle: '/assistant/ningning/idle.webp',
  hover: '/assistant/ningning/pointing.webp',
  open: '/assistant/ningning/thinking.webp',
  thinking: '/assistant/ningning/confused.webp',
  answer: '/assistant/ningning/jump.webp',
  entrance: '/assistant/ningning/jump.webp',
};

export const CHARACTER_ACTION_MS = 1600;

/** Busy actions take priority over hover; opening chat starts in the chin pose. */
export function resolveCharacterMode(state: {
  entering: boolean;
  open: boolean;
  streaming: boolean;
  answering: boolean;
  hovered: boolean;
  waitingForQuestion: boolean;
}): CharacterMode {
  if (state.entering) return 'entrance';
  if (state.open && state.streaming) return 'thinking';
  if (state.open && state.answering) return 'answer';
  if (state.open && state.waitingForQuestion) return 'open';
  if (state.hovered) return 'hover';
  return 'idle';
}
