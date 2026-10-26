import { useCallback, useEffect, useRef, useState } from 'react';
import idleImage from '@/assets/chat-girl-idle.png';

export type CharacterMode = 'idle' | 'hover' | 'open' | 'thinking' | 'answer' | 'entrance';

const VIDEO_URL = '/chat-girl-10s-v6.mp4';
const CANVAS_SIZE = 256;

/** The source video has a white backdrop. Keep the central character and clear
 * the near-white area connected to the crop edge, including the floor shadow. */
function clearBackdrop(pixels: ImageData) {
  const { data, width, height } = pixels;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  const isBackdrop = (index: number) => {
    const offset = index * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);
    // Skin can be light too, but its warm red bias separates it from the backdrop.
    return min >= 170 && max - min < 80 && !(r > g + 16 && r > b + 22);
  };
  for (let x = 0; x < width; x += 1) {
    stack.push(x, (height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    stack.push(y * width, y * width + width - 1);
  }
  while (stack.length) {
    const index = stack.pop()!;
    if (visited[index] || !isBackdrop(index)) continue;
    visited[index] = 1;
    data[index * 4 + 3] = 0;
    const x = index % width;
    if (x > 0) stack.push(index - 1);
    if (x < width - 1) stack.push(index + 1);
    if (index >= width) stack.push(index - width);
    if (index < width * (height - 1)) stack.push(index + width);
  }
}

interface ChatCharacterProps {
  mode: CharacterMode;
  onAnswerEnd: () => void;
}

function ChatCharacter({ mode, onAnswerEnd }: ChatCharacterProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previousMode = useRef<CharacterMode | null>(null);
  const hasFrame = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false);

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
    clearBackdrop(pixels);
    ctx.putImageData(pixels, 0, 0);
    if (!hasFrame.current) {
      hasFrame.current = true;
      setShowCanvas(true);
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
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
  }, [mode, ready, failed, drawFrame, onAnswerEnd]);

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
      <video
        ref={videoRef}
        src={VIDEO_URL}
        muted
        playsInline
        preload="auto"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.001]"
        onLoadedMetadata={() => setReady(true)}
        onSeeked={drawFrame}
        onError={() => setFailed(true)}
      />
    </span>
  );
}

export default ChatCharacter;
