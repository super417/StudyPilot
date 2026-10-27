import { playAssistantSpeech, type SpeechPlayback } from './assistantSpeech';

export const ASSISTANT_GREETING = 'hi，有什么想和我聊聊的吗？';

/** 每次入场播报本地缓存的自然女声问候；退出后取消请求与播放。 */
export function startAssistantGreeting(): () => void {
  let playback: SpeechPlayback | undefined;
  const removeListeners = () => {
    window.removeEventListener('pointerdown', retry);
    window.removeEventListener('keydown', retry);
  };
  const retry = () => {
    removeListeners();
    playback?.retry();
  };
  const timer = window.setTimeout(() => {
    if (document.hidden) return;
    playback = playAssistantSpeech(ASSISTANT_GREETING, {
      greeting: true,
      onBlocked: () => {
        window.addEventListener('pointerdown', retry);
        window.addEventListener('keydown', retry);
      },
      onEnd: removeListeners,
      onError: removeListeners,
    });
  }, 250);
  return () => {
    window.clearTimeout(timer);
    removeListeners();
    playback?.stop();
  };
}
