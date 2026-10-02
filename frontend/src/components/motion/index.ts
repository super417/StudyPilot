/**
 * Motion Library —— 基于 Framer Motion 的可复用动效组件库（需求 18）。
 *
 * 仅导出组件本身，逐页注入由任务 26–30 负责。
 */
export { FADE_IN_EASE, computeMagnetOffset, computeTargetScale } from './utils';
export type { Offset } from './utils';

export { default as FadeIn } from './FadeIn';
export type { FadeInProps } from './FadeIn';

export { default as Magnet } from './Magnet';
export type { MagnetProps } from './Magnet';

export { default as AnimatedText } from './AnimatedText';
export type { AnimatedTextProps } from './AnimatedText';

export { default as StickyStack } from './StickyStack';
export type { StickyStackProps } from './StickyStack';

export { default as ScrollProgressBar } from './ScrollProgressBar';
export type { ScrollProgressBarProps } from './ScrollProgressBar';

export { default as InteractiveCard } from './InteractiveCard';
export type { InteractiveCardProps } from './InteractiveCard';
