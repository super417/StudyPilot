import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { motion, useMotionValue, useReducedMotion, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { ArrowLeft, ArrowUpRight, CheckCircle2, Compass } from 'lucide-react';
import { apiRequest } from '@/lib/httpClient';
import { fetchLatestPlan } from '@/lib/plansApi';
import { validatePolishedSkills, type ResumeAbility } from '@/lib/resumePolish';
import type { SceneMotion } from './Resume3DScene';
import './PersonalWebsiteResume.css';

type Ability = ResumeAbility;

interface ResumePayload {
  verified: Ability[];
  learned: Ability[];
  awaiting: Ability[];
}

type AbilityGroup = 'verified' | 'learned' | 'awaiting';

const EMPTY_RESUME: ResumePayload = { verified: [], learned: [], awaiting: [] };
const Resume3DScene = lazy(() => import('./Resume3DScene'));

const GROUPS: Array<{ id: AbilityGroup; label: string; eyebrow: string }> = [
  { id: 'verified', label: '已验证能力', eyebrow: 'EVIDENCE VERIFIED' },
  { id: 'learned', label: '已学习未验证', eyebrow: 'LEARNED · TO VERIFY' },
  { id: 'awaiting', label: '待获得', eyebrow: 'UP NEXT' },
];

// Decorative reference media from the user-provided prompt. Never presented as a learner's work.
const REFERENCE_GIFS = [
  'https://motionsites.ai/assets/hero-space-voyage-preview-eECLH3Yc.gif',
  'https://motionsites.ai/assets/hero-codenest-preview-Cgppc2qV.gif',
  'https://motionsites.ai/assets/hero-vex-ventures-preview-BczMFIiw.gif',
  'https://motionsites.ai/assets/hero-stellar-ai-v2-preview-DjvxjG3C.gif',
  'https://motionsites.ai/assets/hero-asme-preview-B_nGDnTP.gif',
  'https://motionsites.ai/assets/hero-transform-data-preview-Cx5OU29N.gif',
  'https://motionsites.ai/assets/hero-vitara-preview-Cjz2QYyU.gif',
  'https://motionsites.ai/assets/hero-terra-preview-BFjrCr7T.gif',
  'https://motionsites.ai/assets/hero-skyelite-preview-DHaZIgUv.gif',
  'https://motionsites.ai/assets/hero-aethera-preview-DknSlcTa.gif',
  'https://motionsites.ai/assets/hero-designpro-preview-D8c5_een.gif',
  'https://motionsites.ai/assets/hero-stellar-ai-preview-D3HL6bw1.gif',
  'https://motionsites.ai/assets/hero-xportfolio-preview-D4A8maiC.gif',
  'https://motionsites.ai/assets/hero-orbit-web3-preview-BXt4OttD.gif',
  'https://motionsites.ai/assets/hero-nexora-preview-cx5HmUgo.gif',
  'https://motionsites.ai/assets/hero-evr-ventures-preview-DZxeVFEX.gif',
  'https://motionsites.ai/assets/hero-planet-orbit-preview-DWAP8Z1P.gif',
  'https://motionsites.ai/assets/hero-new-era-preview-CocuDUm9.gif',
  'https://motionsites.ai/assets/hero-wealth-preview-B70idl_u.gif',
  'https://motionsites.ai/assets/hero-luminex-preview-CxOP7ce6.gif',
  'https://motionsites.ai/assets/hero-celestia-preview-0yO3jXO8.gif',
];

const PORTRAIT_URL = 'https://shrug-person-78902957.figma.site/_components/v2/d24c01ad3a56fc65e942a1f501eb73db42d7cf9a/Rectangle_40443.81459862.png';
const ABOUT_IMAGES = [
  'https://shrug-person-78902957.figma.site/_components/v2/ebb2b8f25d8e24d5f0a5ca8af4c950de81aa2fd7/moon_icon.11395d36.png',
  'https://shrug-person-78902957.figma.site/_components/v2/ebb2b8f25d8e24d5f0a5ca8af4c950de81aa2fd7/p59_1.4659672e.png',
  'https://shrug-person-78902957.figma.site/_components/v2/ebb2b8f25d8e24d5f0a5ca8af4c950de81aa2fd7/lego_icon-1.703bb594.png',
  'https://shrug-person-78902957.figma.site/_components/v2/ebb2b8f25d8e24d5f0a5ca8af4c950de81aa2fd7/Group_134-1.2e04f3ce.png',
];
const PROJECT_IMAGES = [
  [
    'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260412_055344_5eff02e0-87a5-41ce-b64f-eb08da8f33db.png&w=1280&q=85',
    'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260412_055431_11d841fd-8b41-46a5-82e4-b04f2407a7d8.png&w=1280&q=85',
    'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260412_055451_e317bf2d-28d4-48cc-86b0-6f72f25b6327.png&w=1280&q=85',
  ],
  [
    'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260412_055654_911201c5-36d9-4bc6-bac7-331adfce159f.png&w=1280&q=85',
    'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260412_055723_5ceda0b8-d9c2-4665-b2e3-83ba19ba76d1.png&w=1280&q=85',
    'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260412_055753_adc5dcbd-a8e6-49c0-b43a-9b030d835cea.png&w=1280&q=85',
  ],
  [
    'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260412_055759_963cfb0b-4bd1-4b0f-9d0a-09bd6cf95b2f.png&w=1280&q=85',
    'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260412_060108_438f781a-9846-4dcc-89ab-c4e6cb830f5b.png&w=1280&q=85',
    'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260412_055818_9d062121-ad7e-46b9-999a-1a6a692ef1ee.png&w=1280&q=85',
  ],
];

function Magnet({ children, disabled }: { children: React.ReactNode; disabled: boolean }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const handleMove = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setOffset({ x: (event.clientX - rect.left - rect.width / 2) / 3, y: (event.clientY - rect.top - rect.height / 2) / 3 });
  };
  return <div className="resume-web-magnet" onMouseMove={handleMove} onMouseLeave={() => setOffset({ x: 0, y: 0 })}>
    <div style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`, transition: offset.x || offset.y ? 'transform .3s ease-out' : 'transform .6s ease-in-out', willChange: 'transform' }}>{children}</div>
  </div>;
}

function scrollToSection(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  const target = event.currentTarget.getAttribute('href')?.slice(1);
  if (target) document.getElementById(target)?.scrollIntoView({ behavior: 'smooth' });
}

function ScrollMarquee({ lowPower }: { lowPower: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const offset = useMotionValue(0);
  useEffect(() => {
    const update = () => {
      if (sectionRef.current) offset.set((window.scrollY - (sectionRef.current.getBoundingClientRect().top + window.scrollY) + window.innerHeight) * 0.3);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [offset]);
  const right = useTransform(offset, (value) => value - 200);
  const left = useTransform(offset, (value) => -(value - 200));
  const rows = [REFERENCE_GIFS.slice(0, 11), REFERENCE_GIFS.slice(11)];
  return (
    <section ref={sectionRef} className="resume-web-marquee" aria-label="视觉灵感画廊">
      {rows.map((images, rowIndex) => (
        <motion.div key={rowIndex} className="resume-web-marquee-row" style={{ x: lowPower ? undefined : rowIndex === 0 ? right : left }}>
          {[...images, ...images, ...images].map((url, index) => (
            <img key={`${rowIndex}-${index}`} src={url} alt="" loading="lazy" decoding="async" />
          ))}
        </motion.div>
      ))}
    </section>
  );
}

function RevealCharacter({ char, index, total, progress }: {
  char: string;
  index: number;
  total: number;
  progress: MotionValue<number>;
}) {
  const opacity = useTransform(progress, [index / total, Math.min(1, (index + 7) / total)], [0.2, 1]);
  return <span className="resume-web-reveal-char"><span aria-hidden="true" className="resume-web-reveal-placeholder">{char}</span><motion.span className="resume-web-reveal-foreground" style={{ opacity }}>{char}</motion.span></span>;
}

function AboutSection({ bio, reduced }: { bio: string; reduced: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start 0.8', 'end 0.2'] });
  const text = bio || '这份个人网站简历展示学习阶段与作答证据。已完成的任务和已验证的能力分别呈现，每个数字都能找到来源。';
  return (
    <section ref={sectionRef} className="resume-web-about" id="resume-web-about" aria-labelledby="resume-web-about-heading">
      {ABOUT_IMAGES.map((url, index) => <motion.img key={url} className={`resume-web-about-image resume-web-about-image-${index + 1}`} src={url} alt="" loading="lazy"
        initial={reduced ? false : { opacity: 0, x: index < 2 ? -80 : 80 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, margin: '50px', amount: 0 }} transition={{ duration: .9, delay: [.1, .25, .15, .3][index] }} />)}
      <motion.h2 id="resume-web-about-heading" className="resume-web-gradient-heading" initial={reduced ? false : { opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '50px', amount: 0 }} transition={{ duration: .7, ease: [.25, .1, .25, 1] }}>ABOUT ME</motion.h2>
      <p className="resume-web-about-text">
        {reduced ? text : [...text].map((char, index) => <RevealCharacter key={index} char={char} index={index} total={text.length} progress={scrollYProgress} />)}
      </p>
      <a href="#resume-web-services" onClick={scrollToSection} className="resume-web-primary-link">查看能力 <ArrowUpRight size={18} /></a>
    </section>
  );
}

function StickyAbility({ item, index, total }: { item: Ability; index: number; total: number }) {
  const cardRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: cardRef, offset: ['start start', 'end start'] });
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1 - (total - 1 - index) * 0.03]);
  return (
    <div className="resume-web-project-slot">
      <motion.article ref={cardRef} className="resume-web-feature-card" style={{ scale, top: `${96 + index * 28}px` }}>
        <div className="resume-web-feature-top">
          <strong>{String(index + 1).padStart(2, '0')}</strong>
          <div><span>VERIFIED LEARNING</span><h3>{item.skill}</h3><p>{item.phase ?? '阶段未关联'} · {item.evidenceCount} 条作答证据 · 掌握度 {item.masteryPercent}%</p></div>
          <a className="resume-web-live-button" href="#resume-web-abilities" onClick={scrollToSection}>查看证据</a>
        </div>
        <div className="resume-web-project-images" aria-label="装饰性视觉素材，不代表本人项目">
          <div><img src={PROJECT_IMAGES[index][0]} alt="" loading="lazy" /><img src={PROJECT_IMAGES[index][1]} alt="" loading="lazy" /></div>
          <img src={PROJECT_IMAGES[index][2]} alt="" loading="lazy" />
        </div>
        <p className="resume-web-project-caption">{item.description} · 图片为设计示意，不代表本人项目。</p>
      </motion.article>
    </div>
  );
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

function tiltCard(event: MouseEvent<HTMLElement>) {
  const card = event.currentTarget;
  const rect = card.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - 0.5;
  const y = (event.clientY - rect.top) / rect.height - 0.5;
  card.style.setProperty('--tilt-x', `${(-y * 10).toFixed(2)}deg`);
  card.style.setProperty('--tilt-y', `${(x * 10).toFixed(2)}deg`);
  card.style.setProperty('--glow-x', `${((x + 0.5) * 100).toFixed(1)}%`);
  card.style.setProperty('--glow-y', `${((y + 0.5) * 100).toFixed(1)}%`);
}

function resetTilt(event: MouseEvent<HTMLElement>) {
  event.currentTarget.style.setProperty('--tilt-x', '0deg');
  event.currentTarget.style.setProperty('--tilt-y', '0deg');
}

function AbilityCard({ item, status, index, motionEnabled }: {
  item: Ability;
  status: AbilityGroup;
  index: number;
  motionEnabled: boolean;
}) {
  const percent = item.masteryPercent;
  const ring = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const label = status === 'verified' ? '已验证' : status === 'learned' ? '待验证' : '待获得';
  return (
    <motion.div
      className="resume-web-card-entry"
      initial={motionEnabled ? { opacity: 0, y: 64, scale: 0.93, rotateX: -11 } : false}
      whileInView={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
      viewport={{ once: true, amount: 0.16 }}
      transition={{ duration: 0.68, delay: Math.min(index * 0.08, 0.32), ease: [0.22, 1, 0.36, 1] }}
    >
      <article
        className="resume-web-card"
        onMouseMove={motionEnabled ? tiltCard : undefined}
        onMouseLeave={motionEnabled ? resetTilt : undefined}
      >
        <div className="resume-web-card-top">
          <span className={`resume-web-status resume-web-status-${status}`}>{label}</span>
          <span className="resume-web-card-index">{String(index + 1).padStart(2, '0')} / SKILL</span>
        </div>
        <div className="resume-web-card-main">
          <div>
            <h3>{item.skill}</h3>
            <p className="resume-web-card-description">{item.description}</p>
          </div>
          <div className="resume-web-ring" style={{ '--ring-percent': `${ring}%` } as React.CSSProperties}>
            <div className="resume-web-ring-core">
              <strong>{percent == null ? '—' : `${percent}%`}</strong>
              <span>掌握度</span>
            </div>
          </div>
        </div>
        <div className="resume-web-card-meta">
          <span>{item.phase ?? '尚无对应阶段'}</span>
          <span>{item.evidenceCount} 条作答证据</span>
        </div>
      </article>
    </motion.div>
  );
}

function PersonalWebsiteResume({ onBack }: { onBack?: () => void }) {
  const [resume, setResume] = useState<ResumePayload>(EMPTY_RESUME);
  const [nickname, setNickname] = useState('');
  const [direction, setDirection] = useState('');
  const [bio, setBio] = useState('');
  const [goalName, setGoalName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneActive, setSceneActive] = useState(true);
  const [activeGroup, setActiveGroup] = useState<AbilityGroup>('verified');
  const sceneMotion = useRef<SceneMotion>({ pointerX: 0, pointerY: 0, scroll: 0 });
  const heroRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const lowPower = useMemo(() => {
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    return window.matchMedia('(max-width: 720px)').matches ||
      (navigator.hardwareConcurrency || 8) <= 4 ||
      (memory != null && memory <= 4);
  }, []);
  const showScene = useMemo(() => !reducedMotion && supportsWebGL(), [reducedMotion]);
  const motionEnabled = !reducedMotion && !lowPower;
  const handleSceneReady = useCallback(() => setSceneReady(true), []);

  useEffect(() => {
    if (!showScene) setSceneReady(true);
  }, [showScene]);

  useEffect(() => {
    if (!heroRef.current || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(([entry]) => setSceneActive(entry.isIntersecting));
    observer.observe(heroRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    async function load() {
      const results = await Promise.allSettled([
        apiRequest<ResumePayload>('/api/resume'),
        apiRequest<{ profile: { nickname?: string; direction?: string; bio?: string } }>('/api/profile'),
        fetchLatestPlan(),
      ]);
      if (!alive) return;
      if (results[0].status === 'fulfilled') setResume(results[0].value);
      else setError('能力证据暂时无法加载，请稍后刷新。');
      if (results[1].status === 'fulfilled') {
        setNickname(results[1].value.profile.nickname?.trim() ?? '');
        setDirection(results[1].value.profile.direction?.trim() ?? '');
        setBio(results[1].value.profile.bio?.trim() ?? '');
      }
      if (results[2].status === 'fulfilled') {
        setGoalName(results[2].value.plan?.goalName?.trim() ?? '');
      }
      setDataReady(true);
    }
    void load();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${nickname || 'Learner'} -- Learning Portfolio`;
    return () => { document.title = previousTitle; };
  }, [nickname]);

  useEffect(() => {
    const updatePointer = (event: PointerEvent) => {
      sceneMotion.current.pointerX = (event.clientX / window.innerWidth - 0.5) * 2;
      sceneMotion.current.pointerY = (event.clientY / window.innerHeight - 0.5) * 2;
    };
    const updateScroll = () => {
      sceneMotion.current.scroll = Math.min(1, Math.max(0, window.scrollY / Math.max(1, window.innerHeight * 1.2)));
    };
    updateScroll();
    window.addEventListener('pointermove', updatePointer, { passive: true });
    window.addEventListener('scroll', updateScroll, { passive: true });
    return () => {
      window.removeEventListener('pointermove', updatePointer);
      window.removeEventListener('scroll', updateScroll);
    };
  }, []);

  const items = resume[activeGroup];
  const handlePolish = async () => {
    const source = [...resume.verified, ...resume.learned, ...resume.awaiting];
    if (!source.length) return;
    setActionError(null);
    setPolishing(true);
    try {
      const response = await apiRequest<{ skills: unknown }>('/api/resume/polish', {
        method: 'POST', body: JSON.stringify({ skills: source }),
      });
      const polished = validatePolishedSkills(source, response.skills);
      let offset = 0;
      const verified = polished.slice(offset, offset += resume.verified.length);
      const learned = polished.slice(offset, offset += resume.learned.length);
      const awaiting = polished.slice(offset);
      setResume({ verified, learned, awaiting });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '润色失败，请稍后重试。');
    } finally {
      setPolishing(false);
    }
  };
  const handleExport = async () => {
    setActionError(null);
    setExporting(true);
    try {
      const { exportResumePdf } = await import('@/lib/resumePdf');
      await exportResumePdf({ nickname, direction, goalName, ...resume });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'PDF 导出失败，请稍后重试。');
    } finally {
      setExporting(false);
    }
  };
  const progress = (dataReady ? 50 : 0) + (sceneReady ? 50 : 0);

  return (
    <div className="resume-web-site">
      <div className="resume-web-scene" aria-hidden="true">
        {showScene ? (
          <Suspense fallback={<div className="resume-web-static-orbit" />}>
            <Resume3DScene motion={sceneMotion} lowPower={lowPower} active={sceneActive} onReady={handleSceneReady} />
          </Suspense>
        ) : <div className="resume-web-static-orbit" />}
      </div>
      <div className="resume-web-noise" aria-hidden="true" />

      {progress < 100 && (
        <div className="resume-web-loading" role="status" aria-live="polite">
          <span>正在载入个人网站简历</span>
          <strong>{progress}%</strong>
          <div className="resume-web-loading-track"><i style={{ width: `${progress}%` }} /></div>
        </div>
      )}

      {onBack && (
        <header className="resume-web-topbar">
          <button type="button" className="resume-web-back" onClick={onBack} aria-label="返回我的简历">
            <ArrowLeft size={18} aria-hidden="true" /> 返回
          </button>
        </header>
      )}

      <section ref={heroRef} className="resume-web-hero" aria-labelledby="resume-web-heading">
        <motion.nav className="resume-web-nav" aria-label="个人网站导航" initial={motionEnabled ? { opacity: 0, y: -20 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7 }}>
          <a href="#resume-web-about" onClick={scrollToSection}>About</a><a href="#resume-web-services" onClick={scrollToSection}>Price</a><a href="#resume-web-features" onClick={scrollToSection}>Projects</a><a href="#resume-web-footer" onClick={scrollToSection}>Contact</a>
        </motion.nav>
        <div className="resume-web-heading-clip"><motion.h1 id="resume-web-heading" className="resume-web-gradient-heading" initial={motionEnabled ? { opacity: 0, y: 40 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .15 }}>
          Hi, i&apos;m {nickname || 'a learner'}
        </motion.h1></div>
        <motion.div className="resume-web-portrait" initial={motionEnabled ? { opacity: 0, y: 30 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .6 }}>
          <Magnet disabled={!motionEnabled}><img src={PORTRAIT_URL} alt="" /></Magnet><span className="resume-web-portrait-note">装饰性示意图片</span>
        </motion.div>
        <div className="resume-web-hero-bottom">
          <motion.p initial={motionEnabled ? { opacity: 0, y: 20 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .35 }}>
            A learner driven by building skills with real evidence. {direction && `Learning direction: ${direction}.`}
          </motion.p>
          <motion.a href="#resume-web-footer" onClick={scrollToSection} className="resume-web-primary-link" initial={motionEnabled ? { opacity: 0, y: 20 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .5 }}>Contact Me</motion.a>
        </div>
      </section>

      <ScrollMarquee lowPower={lowPower || Boolean(reducedMotion)} />
      <AboutSection bio={bio} reduced={Boolean(reducedMotion)} />

      <section id="resume-web-services" className="resume-web-services" aria-labelledby="resume-web-services-heading">
        <h2 id="resume-web-services-heading">Services</h2>
        <p className="resume-web-services-subtitle">以下展示真实学习能力；无证据的阶段不会标为已验证。</p>
        <div className="resume-web-service-list">
          {[...resume.verified, ...resume.learned].slice(0, 5).map((item, index) => (
            <motion.article key={`${item.phase}-${index}`} initial={motionEnabled ? { opacity: 0, y: 44 } : false} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, delay: index * 0.08 }}>
              <strong>{String(index + 1).padStart(2, '0')}</strong>
              <div><h3>{item.skill}</h3><p>{item.description}</p><p className="resume-web-service-evidence">{item.phase ?? '阶段未关联'} · {item.evidenceCount} 条作答证据 · {item.masteryPercent == null ? '掌握度暂无证据' : `掌握度 ${item.masteryPercent}%`}</p></div>
            </motion.article>
          ))}
          {dataReady && !error && resume.verified.length + resume.learned.length === 0 && <p className="resume-web-services-empty">尚无有记录的已验证或已完成阶段。</p>}
        </div>
        <div id="resume-web-abilities" className="resume-web-abilities" aria-labelledby="resume-web-abilities-heading">
        <div className="resume-web-section-head">
          <div>
            <span className="resume-web-eyebrow">04 / CAPABILITIES</span>
            <h2 id="resume-web-abilities-heading">能力，<em>有据可查。</em></h2>
          </div>
          <p>从阶段作答中提取掌握度。<br />每一张卡片都标明它的来源。</p>
        </div>
        <div className="resume-web-group-tabs" role="tablist" aria-label="能力状态">
          {GROUPS.map((group) => (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={activeGroup === group.id}
              onClick={() => setActiveGroup(group.id)}
              className={activeGroup === group.id ? 'is-active' : ''}
            >
              <span>{group.eyebrow}</span>
              {group.label} <b>{resume[group.id].length}</b>
            </button>
          ))}
        </div>
        {error ? <p className="resume-web-empty" role="alert">{error}</p> : items.length ? (
          <div className="resume-web-grid">
            {items.map((item, index) => <AbilityCard key={`${activeGroup}-${item.phase}-${item.skill}`} item={item} status={activeGroup} index={index} motionEnabled={motionEnabled} />)}
          </div>
        ) : (
          <div className="resume-web-empty">
            {activeGroup === 'verified' && <><CheckCircle2 size={28} /><p>暂无已验证能力。完成练习并留下作答证据后，这里会显示达到门槛的阶段。</p></>}
            {activeGroup === 'learned' && <><Compass size={28} /><p>暂无已完成但待验证的阶段。</p></>}
            {activeGroup === 'awaiting' && <><Compass size={28} /><p>尚无可核实的“未开始技能”映射，暂不推测待获得能力。</p></>}
          </div>
        )}
          <div className="resume-web-tools" aria-label="简历操作">
            <button type="button" onClick={() => void handlePolish()} disabled={polishing || !dataReady || Boolean(error) || resume.verified.length + resume.learned.length + resume.awaiting.length === 0}>{polishing ? '润色中…' : '润色描述'}</button>
            <button type="button" onClick={() => void handleExport()} disabled={exporting || !dataReady || Boolean(error)}>{exporting ? '导出中…' : '导出 PDF'}</button>
          </div>
          {actionError && <p className="resume-web-action-error" role="alert">{actionError}</p>}
        </div>
      </section>

      <section id="resume-web-features" className="resume-web-features" aria-labelledby="resume-web-features-heading">
        <h2 id="resume-web-features-heading" className="resume-web-gradient-heading">Project</h2>
        <p className="resume-web-features-subtitle">卡片展示真实学习证据；图片仅作排版示意，不代表本人项目。</p>
        {resume.verified.slice(0, 3).map((item, index, visible) => (
          <StickyAbility key={`${item.phase}-${index}`} item={item} index={index} total={visible.length} />
        ))}
        {dataReady && !error && resume.verified.length === 0 && <p className="resume-web-services-empty">暂无可展示的已验证能力证据。</p>}
      </section>

      <footer id="resume-web-footer" className="resume-web-footer">
        <span>STUDYPILOT / PERSONAL WEBSITE RESUME</span>
        <p>{goalName ? `学习目标：${goalName}` : '尚未设定学习目标'} · 学习有迹，能力有证。</p>
        <a href="#resume-web-heading" onClick={scrollToSection}>回到顶部 ↑</a>
      </footer>
    </div>
  );
}

export default PersonalWebsiteResume;
