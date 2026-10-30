import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import fallbackImage from '@/assets/chat-girl-idle.png';
import { CHARACTER_ACTION_MS, CHARACTER_IMAGES, type CharacterMode } from '@/lib/assistantCharacter';
import { CHARACTER_VIDEOS, clearAssistantGreenScreen, nextCharacterSegment, type CharacterSegment, type VideoPose } from '@/lib/assistantVideo';
import './ChatCharacter.css';

interface ChatCharacterProps {
  mode: CharacterMode;
  onAnswerEnd: () => void;
}

const CANVAS_SIZE = 360;

function ChatCharacter({ mode, onAnswerEnd }: ChatCharacterProps) {
  const reducedMotion = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videos = useRef<Partial<Record<keyof typeof CHARACTER_VIDEOS, HTMLVideoElement>>>({});
  const requested = useRef(mode);
  requested.current = mode;
  const onEnd = useRef(onAnswerEnd);
  onEnd.current = onAnswerEnd;
  const [hasFrame, setHasFrame] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!reducedMotion && !failed) return;
    if (mode !== 'answer' && mode !== 'entrance') return;
    const timer = window.setTimeout(() => onEnd.current(), reducedMotion ? 0 : CHARACTER_ACTION_MS);
    return () => window.clearTimeout(timer);
  }, [mode, reducedMotion, failed]);

  useEffect(() => {
    if (reducedMotion) return;
    let stopped = false;
    let cancelPlayback = () => {};
    let pose: VideoPose = 'idle';
    let finishedAction: CharacterMode | undefined;
    const context = canvasRef.current?.getContext('2d', { willReadFrequently: true });
    if (!context) { setFailed(true); return; }
    const draw = (video: HTMLVideoElement) => {
      context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      context.drawImage(video, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      const pixels = context.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      clearAssistantGreenScreen(pixels);
      context.putImageData(pixels, 0, 0);
      setHasFrame(true);
    };
    const play = (segment: CharacterSegment) => new Promise<void>((resolve, reject) => {
      const video = videos.current[segment.video]!;
      let frame = 0;
      let settled = false;
      let lastTime = -1;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.cancelAnimationFrame(frame);
        video.pause();
        video.removeEventListener('loadedmetadata', seek);
        video.removeEventListener('seeked', start);
        video.removeEventListener('error', onError);
        video.removeEventListener('ended', onEnded);
        if (error) reject(error); else resolve();
      };
      const timeout = window.setTimeout(() => finish(new Error('Video stalled')), (segment.end - segment.start) * 1000 + 12000);
      cancelPlayback = () => finish();
      const onError = () => finish(new Error('Video unavailable'));
      const onEnded = () => finish();
      const tick = () => {
        if (stopped) { finish(); return; }
        const target = requested.current === finishedAction ? 'idle' : requested.current;
        // Check before drawing: a background tab may resume past the hold end.
        if (video.currentTime >= segment.end || (segment.hold && target !== segment.hold)) { finish(); return; }
        const sourceFrame = Math.floor(video.currentTime * 24);
        if (!video.seeking && video.readyState >= 2 && lastTime !== sourceFrame) {
          try { draw(video); } catch { onError(); return; }
          lastTime = sourceFrame;
        }
        // Stable holds may exit immediately. Finish sit/stand/jump transitions
        // first, so quick replies never cut a limb mid-move.
        frame = window.requestAnimationFrame(tick);
      };
      const start = () => {
        video.removeEventListener('seeked', start);
        if (stopped || settled) return;
        video.play().then(() => { if (!settled) tick(); }).catch(onError);
      };
      const seek = () => {
        video.removeEventListener('loadedmetadata', seek);
        if (stopped || settled) return;
        if (Math.abs(video.currentTime - segment.start) < .001 && video.readyState >= 2) start();
        else {
          video.addEventListener('seeked', start, { once: true });
          video.currentTime = segment.start;
        }
      };
      video.addEventListener('error', onError);
      video.addEventListener('ended', onEnded);
      if (video.error) onError();
      else if (video.readyState >= 1) seek();
      else video.addEventListener('loadedmetadata', seek, { once: true });
    });
    const run = async () => {
      try {
        while (!stopped) {
          const target = requested.current;
          if (target !== finishedAction) finishedAction = undefined;
          const segment = nextCharacterSegment(pose, target === finishedAction ? 'idle' : target);
          await play(segment);
          if (stopped) break;
          pose = segment.pose;
          if (segment.finish && requested.current === segment.finish) {
            finishedAction = segment.finish;
            onEnd.current();
          }
        }
      } catch {
        if (!stopped) setFailed(true);
      }
    };
    void run();
    return () => {
      stopped = true;
      cancelPlayback();
    };
  }, [reducedMotion]);

  const showVideo = hasFrame && !failed && !reducedMotion;
  return (
    <span className="assistant-character" data-character-mode={mode} data-character-renderer={showVideo ? 'video' : 'image'} aria-hidden="true">
      <img src={reducedMotion || failed ? CHARACTER_IMAGES[mode] : fallbackImage} alt="" draggable={false}
        onError={(event) => { if (event.currentTarget.getAttribute('src') !== fallbackImage) event.currentTarget.src = fallbackImage; }}
        className={`assistant-character__pose ${!showVideo ? 'assistant-character__pose--active' : ''}`} />
      <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} className={`assistant-character__pose ${showVideo ? 'assistant-character__pose--active' : ''}`} />
      {Object.entries(CHARACTER_VIDEOS).map(([name, src]) => (
        <video key={name} ref={(element) => { if (element) videos.current[name as keyof typeof CHARACTER_VIDEOS] = element; }}
          src={src} muted playsInline preload="auto" className="assistant-character__source" />
      ))}
    </span>
  );
}

export default ChatCharacter;
