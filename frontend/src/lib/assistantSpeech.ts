import { apiRequest, getApiBaseUrl } from './httpClient';

interface SpeechAudio {
  voice: 'Xiaoxiao';
  mimeType: 'audio/mpeg';
  audioBase64: string;
}
interface SpeechStream {
  voice: 'Xiaoxiao';
  audioPath: string;
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
  onPreparing?: () => void;
  onPlaying?: (startupMs: number) => void;
}

let activePlayback: SpeechPlayback | null = null;

/** 保留全文，按句拆成小段，避免长回复超过合成上限。 */
export function speechChunks(text: string): string[] {
  const remaining = Array.from(text.trim());
  const chunks: string[] = [];
  while (remaining.length) {
    // 流式播放无需等整段合成结束，减少短段之间重复建立连接。
    let length = Math.min(280, remaining.length);
    if (remaining.length > length) {
      for (let i = length - 1; i >= 80; i -= 1) {
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

/** 用户授权：仅在新回复完整生成后预备其正文；不自动播放或扫描历史。 */
export async function prewarmAssistantSpeech(text: string): Promise<void> {
  for (const chunk of speechChunks(text)) {
    try {
      const result = await apiRequest<{ ready: boolean }>('/api/speech/prewarm', {
        method: 'POST', body: JSON.stringify({ text: chunk }),
      });
      if (!result.ready) return;
    } catch {
      // 预备失败不打断聊天，用户点击时仍可走流式播放并重试。
      return;
    }
  }
}

/** 问候和获准启用的回复共用晓晓自然女声音频播放通道。 */
export function playAssistantSpeech(text: string, options: PlaybackOptions = {}): SpeechPlayback {
  activePlayback?.stop();
  const audio = new Audio();
  audio.crossOrigin = 'use-credentials';
  const startedAt = performance.now();
  let startupMs: number | undefined;
  const controller = new AbortController();
  const chunks = options.greeting ? [text] : speechChunks(text);
  let stopped = false;
  let blocked = false;
  let index = 0;
  const prepare = async (chunk: string): Promise<{ data: SpeechAudio | SpeechStream } | { error: unknown }> => {
    try {
      const data = await apiRequest<SpeechAudio | SpeechStream>(
        options.greeting ? '/api/speech/greeting' : '/api/speech/playback',
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
    audio.onplaying = null;
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
    options.onPreparing?.();
    try {
      const result = await prepared!;
      if (stopped) return;
      if ('error' in result) throw result.error;
      const { data } = result;
      if (data.voice !== 'Xiaoxiao') {
        throw new Error('语音响应异常，请重试');
      }
      if ('audioPath' in data && /^\/api\/speech\/playback\/[\w-]+$/.test(data.audioPath)) {
        audio.src = `${getApiBaseUrl()}${data.audioPath}`;
      } else if ('mimeType' in data && data.mimeType === 'audio/mpeg' && data.audioBase64) {
        audio.src = `data:audio/mpeg;base64,${data.audioBase64}`;
      } else {
        throw new Error('语音响应异常，请重试');
      }
      index += 1;
      // 只为所选回复的下一段创建短期播放凭证，不上传其他消息。
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
  audio.onplaying = () => {
    if (stopped) return;
    startupMs ??= Math.round(performance.now() - startedAt);
    options.onPlaying?.(startupMs);
  };
  audio.onerror = () => finish(new Error('语音连接中断，请点击喇叭重试'));
  void next();
  return playback;
}
