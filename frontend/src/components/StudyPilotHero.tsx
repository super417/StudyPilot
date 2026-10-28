import { useEffect, useRef, useState } from 'react';
import type { TabKey } from '@/components/TabNav';
import './StudyPilotHero.css';
import { scrollToLearningOverview } from '@/lib/overviewNavigation';

const SKY_VIDEO = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260912_111243_26a0a351-0bff-4c24-9872-14c77a2726f6.mp4';
const PROJECTOR = 'https://soft-zoom-63098134.figma.site/_assets/v11/83aecec75c5d8511dbb24e3a6369d7380e3f2278.png';
const MARQUEE_TEXT = 'STUDYPILOT·LEARN·GROW·'.repeat(5);
let entrancePlayed = false;

interface StudyPilotHeroProps {
  onNavigate: (tab: TabKey) => void;
  overlap: number;
}

function StudyPilotHero({ onNavigate, overlap }: StudyPilotHeroProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [entranceDone, setEntranceDone] = useState(entrancePlayed);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (entrancePlayed) return;
    const finishEntrance = () => {
      entrancePlayed = true;
      setEntranceDone(true);
    };
    if (typeof Element.prototype.animate !== 'function') {
      finishEntrance();
      return;
    }

    const animations: Animation[] = [];
    let cancelled = false;
    const animate = (selector: string, frames: Keyframe[], duration: number, delay: number, easing = 'cubic-bezier(.22,1,.36,1)') => {
      const element = stage.querySelector(selector);
      if (element) animations.push(element.animate(frames, { duration, delay, easing, fill: 'both' }));
    };
    const frame = window.requestAnimationFrame(() => {
      animate('.sp-hero-hi', [{ opacity: 0, translate: '0 7px' }, { opacity: 1, translate: '0 0' }], 520, 40);
      animate('.sp-hero-name', [
        { opacity: 0, translate: '0 15px', clipPath: 'inset(100% 0 0 0)' },
        { opacity: 1, translate: '0 0', clipPath: 'inset(0 0 0 0)' },
      ], 760, 135, 'cubic-bezier(.16,1,.3,1)');
      animate('.sp-hero-role', [{ opacity: 0, translate: '0 8px' }, { opacity: 1, translate: '0 0' }], 580, 430);
      animate('.sp-hero-scene-assembly', [
        { opacity: 0, translate: '0 18px', scale: '.985' },
        { opacity: 1, translate: '0 0', scale: '1' },
      ], 980, 390, 'cubic-bezier(.16,1,.3,1)');
      stage.querySelectorAll('.sp-hero-nav button, .sp-hero-mode').forEach((element, index) => {
        animations.push(element.animate(
          [{ opacity: 0, translate: '-7px 0' }, { opacity: 1, translate: '0 0' }],
          { duration: 470, delay: 690 + index * 52, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' },
        ));
      });
      void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
        if (!cancelled) finishEntrance();
      });
    });
    const failsafe = window.setTimeout(finishEntrance, 2800);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(failsafe);
      animations.forEach((animation) => animation.cancel());
    };
  }, []);

  useEffect(() => {
    const sky = videoRef.current;
    const stage = stageRef.current;
    if (!sky || !stage) return;
    if (!motionEnabled) {
      sky.pause();
      sky.removeAttribute('src');
      sky.load();
      sky.classList.remove('is-playing');
      return;
    }
    sky.src = SKY_VIDEO;
    sky.loop = false;
    const reveal = () => sky.classList.add('is-playing');
    const hide = () => sky.classList.remove('is-playing');
    const rewind = () => {
      try { sky.currentTime = 3; } catch { /* Media may not be seekable yet. */ }
      if (sky.paused) void sky.play().catch(() => {});
    };
    const nearEnd = () => {
      if (sky.duration && sky.currentTime >= sky.duration - 0.25) rewind();
    };
    const playVideo = () => {
      void sky.play().then(reveal).catch(() => {});
    };
    let retried = false;
    const retry = () => {
      if (retried) return;
      retried = true;
      playVideo();
    };
    if (sky.readyState >= 3) reveal();
    sky.addEventListener('playing', reveal);
    sky.addEventListener('error', hide);
    sky.addEventListener('ended', rewind);
    sky.addEventListener('timeupdate', nearEnd);
    stage.addEventListener('pointerdown', retry, { once: true });
    stage.addEventListener('touchstart', retry, { once: true });
    playVideo();
    return () => {
      sky.removeEventListener('playing', reveal);
      sky.removeEventListener('error', hide);
      sky.removeEventListener('ended', rewind);
      sky.removeEventListener('timeupdate', nearEnd);
      stage.removeEventListener('pointerdown', retry);
      stage.removeEventListener('touchstart', retry);
      sky.pause();
    };
  }, [motionEnabled]);

  const goToOverview = scrollToLearningOverview;
  const goToJourney = () => {
    document.getElementById('study-journey')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'start',
    });
  };

  return (
    <section
      ref={stageRef}
      className={`sp-hero-stage ${entranceDone ? 'sp-hero-ready' : 'sp-hero-pending'} ${motionEnabled ? '' : 'sp-hero-static'}`}
      style={{ marginTop: -overlap }}
      aria-label="StudyPilot 学习首屏"
    >
      <div className="sp-hero-sky">
        <video ref={videoRef} aria-hidden="true" autoPlay muted loop playsInline preload="auto" disablePictureInPicture tabIndex={-1} />
      </div>
      <div className="sp-hero-marquee" aria-hidden="true">
        <div className="sp-hero-marquee-track">
          <div className="sp-hero-marquee-run"><span>{MARQUEE_TEXT}</span><span>{MARQUEE_TEXT}</span></div>
        </div>
      </div>
      <div className="sp-hero-scene-assembly" aria-hidden="true">
        <div className="sp-hero-skirt" />
        <img className="sp-hero-scene" src={PROJECTOR} alt="" draggable={false} />
      </div>
      <header className="sp-hero-intro">
        <p className="sp-hero-hi">Hi, 欢迎来到</p>
        <h1 className="sp-hero-name">StudyPilot</h1>
        <p className="sp-hero-role"><span>让学习目标有方向，让每一步进展看得见。</span><span>从今天开始，按自己的节奏向前。</span></p>
      </header>
      <nav className="sp-hero-nav" aria-label="首屏快捷入口">
        <button type="button" className="sp-hero-home" onClick={goToOverview}>开始学习</button>
        <button type="button" className="sp-hero-n1" onClick={goToOverview}>查看总览</button>
        <button type="button" className="sp-hero-n2" onClick={() => onNavigate('roadmap')}>学习路线</button>
        <button type="button" className="sp-hero-n3" onClick={() => onNavigate('resume')}>我的简历</button>
        <div className="sp-hero-mode">
          <span className="sp-hero-mode-label">动态<br />模式</span>
          <button
            type="button"
            className="sp-hero-switch"
            role="switch"
            aria-checked={motionEnabled}
            aria-label="动态模式"
            onClick={() => setMotionEnabled((enabled) => !enabled)}
          >
            <span className="sp-hero-on">ON</span>
            <span className="sp-hero-off">OFF</span>
            <span className="sp-hero-knob" />
          </button>
        </div>
      </nav>
      <button type="button" className="sp-hero-scroll" onClick={goToJourney}>向下继续探索 <span aria-hidden="true">↓</span></button>
    </section>
  );
}

export default StudyPilotHero;
