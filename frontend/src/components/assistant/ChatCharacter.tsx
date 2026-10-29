import { useCallback, useEffect, useRef, useState } from 'react';
import idleImage from '@/assets/chat-girl-idle.png';
import { clearAssistantBackdrop } from '@/lib/assistantBackdrop';

export type CharacterMode = 'idle' | 'hover' | 'open' | 'thinking' | 'answer' | 'entrance';

const VIDEO_URL = '/chat-girl-10s-v6.mp4';
const CANVAS_SIZE = 256;

interface ChatCharacterProps {
  mode: CharacterMode;
  onAnswerEnd: () => void;
}

function ChatCharacter({ mode, onAnswerEnd }: ChatCharacterProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previousMode = useRef<CharacterMode | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const drawFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const side = Math.min(video.videoWidth * 0.34, video.videoHeight * 0.66);
    const left = (video.videoWidth - side) / 2;
    const top = (video.videoHeight - side) / 2;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.drawImage(video, left, top, side, side, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const pixels = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    clearAssistantBackdrop(pixels);
    ctx.putImageData(pixels, 0, 0);
    // The supplied transparent full-body portrait is exact for the idle pose.
    // Keep the video for all moving/seated/thinking/jumping poses.
    setShowCanvas(video.currentTime > 0.5);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (reducedMotion) {
      video?.pause();
      setShowCanvas(false);
      if (mode === 'answer' || mode === 'entrance') onAnswerEnd();
      return;
    }
    if (!ready || !video || failed) return;
    const previous = previousMode.current;
    previousMode.current = mode;
    video.pause();

    if (mode === 'idle' && (previous === null || previous === 'entrance')) {
      video.currentTime = 0.35;
      return;
    }
    if (mode === 'open' && previous === 'answer') {
      video.currentTime = 7.4; // the answer animation has landed in the seated pose
      return;
    }

    let start: number;
    let end: number;
    let settle: number | undefined;
    if (mode === 'idle') {
      start = 7.65;
      end = 8.8;
      settle = 0.35;
    } else if (mode === 'hover') {
      start = 1.2;
      end = 2.2;
    } else if (mode === 'open') {
      start = previous === 'hover' && video.currentTime >= 1.2 && video.currentTime < 3.35
        ? video.currentTime
        : 1.2;
      end = 3.35;
    } else if (mode === 'thinking') {
      start = 3.4;
      end = 5.05;
    } else if (mode === 'entrance') {
      // 总览入场使用双手举起的跳跃段；前面的 3–5 秒是挠头。
      start = 5;
      end = 8;
      settle = 0.35;
    } else {
      start = 5.15;
      end = 7.5;
    }

    let cancelled = false;
    let frameId = 0;
    const tick = () => {
      if (cancelled) return;
      drawFrame();
      if (video.currentTime >= end) {
        video.pause();
        video.currentTime = settle ?? end;
        if (mode === 'answer' || mode === 'entrance') onAnswerEnd();
        return;
      }
      frameId = window.requestAnimationFrame(tick);
    };
    const begin = () => {
      if (cancelled) return;
      drawFrame();
      void video.play().then(() => {
        if (!cancelled) frameId = window.requestAnimationFrame(tick);
      }).catch(() => setFailed(true));
    };
    if (Math.abs(video.currentTime - start) < 0.02) {
      begin();
    } else {
      video.addEventListener('seeked', begin, { once: true });
      video.currentTime = start;
    }
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
      video.removeEventListener('seeked', begin);
      video.pause();
    };
  }, [mode, ready, failed, drawFrame, onAnswerEnd, reducedMotion]);

  return (
    <span className="relative block h-full w-full" aria-hidden="true">
      <img
        src={idleImage}
        alt=""
        className={`absolute inset-0 h-full w-full object-contain ${showCanvas && !failed ? 'hidden' : ''}`}
      />
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        className={`h-full w-full ${showCanvas && !failed ? '' : 'hidden'}`}
      />
      {!reducedMotion && <video
        ref={videoRef}
        src={VIDEO_URL}
        muted
        playsInline
        preload="auto"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.001]"
        onLoadedMetadata={() => setReady(true)}
        onSeeked={drawFrame}
        onError={() => setFailed(true)}
      />}
    </span>
  );
}

export default ChatCharacter;
