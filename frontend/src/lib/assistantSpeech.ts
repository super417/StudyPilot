import { apiRequest } from './httpClient';

interface SpeechAudio {
  voice: 'Xiaoxiao';
  mimeType: 'audio/mpeg';
  audioBase64: string;
}

export interface SpeechPlayback {
  stop: () => void;
  retry: () => void;
  readonly blocked: boolean;
}

interface PlaybackOptions {
  greeting?: boolean;
  onEnd?: () => void;
  onError?: (error: Error) => void;
  onBlocked?: () => void;
}

let activePlayback: SpeechPlayback | null = null;

/** 保留全文，按句拆成小段，避免长回复超过合成上限。 */
export function speechChunks(text: string): string[] {
  const remaining = Array.from(text.trim());
  const chunks: string[] = [];
  while (remaining.length) {
    let length = Math.min(160, remaining.length);
    if (remaining.length > length) {
      for (let i = length - 1; i >= 60; i -= 1) {
        if (/[。！？!?；;\n]/.test(remaining[i])) {
          length = i + 1;
          break;
        }
      }
    }
    const chunk = remaining.splice(0, length).join('').trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

/** 问候和获准启用的回复共用晓晓自然女声音频播放通道。 */
export function playAssistantSpeech(text: string, options: PlaybackOptions = {}): SpeechPlayback {
  activePlayback?.stop();
  const audio = new Audio();
  const controller = new AbortController();
  const chunks = options.greeting ? [text] : speechChunks(text);
  let stopped = false;
  let blocked = false;
  let index = 0;
  const prepare = async (chunk: string): Promise<{ data: SpeechAudio } | { error: unknown }> => {
    try {
      const data = await apiRequest<SpeechAudio>(
        options.greeting ? '/api/speech/greeting' : '/api/speech/synthesize',
        options.greeting ? { signal: controller.signal } : {
          method: 'POST', body: JSON.stringify({ text: chunk }), signal: controller.signal,
        },
      );
      return { data };
    } catch (error) { return { error }; }
  };
  let prepared = chunks.length ? prepare(chunks[0]) : null;

  const finish = (error?: Error) => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (activePlayback === playback) activePlayback = null;
    if (error) options.onError?.(error);
    else options.onEnd?.();
  };
  const play = () => {
    if (stopped) return;
    blocked = false;
    void audio.play().catch((error: unknown) => {
      if (stopped) return;
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        blocked = true;
        options.onBlocked?.();
      } else {
        finish(new Error('语音播放失败，请重试'));
      }
    });
  };
  const next = async () => {
    if (stopped) return;
    if (index >= chunks.length) { finish(); return; }
    try {
      const result = await prepared!;
      if (stopped) return;
      if ('error' in result) throw result.error;
      const { data } = result;
      if (data.voice !== 'Xiaoxiao' || data.mimeType !== 'audio/mpeg' || !data.audioBase64) {
        throw new Error('语音响应异常，请重试');
      }
      audio.src = `data:audio/mpeg;base64,${data.audioBase64}`;
      index += 1;
      // 当前段播放时只预取下一段，减少长回复段落之间的等待。
      prepared = index < chunks.length ? prepare(chunks[index]) : null;
      play();
    } catch (error) {
      if (!stopped) finish(error instanceof Error ? error : new Error('语音暂不可用'));
    }
  };
  const playback: SpeechPlayback = {
    stop: () => finish(),
    retry: () => { if (blocked) play(); },
    get blocked() { return blocked; },
  };
  activePlayback = playback;
  audio.onended = () => { void next(); };
  audio.onerror = () => finish(new Error('语音播放失败，请重试'));
  void next();
  return playback;
}
