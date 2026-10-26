import { Suspense, lazy, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { motion, useMotionValue, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { apiRequest } from '@/lib/httpClient';
import { fetchLatestPlan, type LatestPlanResponse } from '@/lib/plansApi';
import { fetchPhaseTasks } from '@/lib/studyApi';
import type { DailyTask } from '@/mocks/types';
import { fetchBasicProfile, type BasicProfile } from '@/lib/profilePrefs';
import { buildResumeHeroSummary } from '@/lib/resumeIntro';
import { fetchResumeDocument } from '@/lib/resumeDocumentApi';
import { buildAboutText, buildAchievementPairs, buildAdvantages, buildDisplayAbilities, formatPhaseSource, readPersonalResumeFacts, type AchievementPair, type DisplayAbility, type PersonalResumeFacts } from '@/lib/personalWebsiteResumeData';
import type { ResumeAbility } from '@/lib/resumePolish';
import { ABOUT_IMAGES, PORTRAIT_URL, PROJECT_IMAGES, REFERENCE_GIFS } from './jackPortfolioAssets';
import './PersonalWebsiteResume.css';

const ResumeInkCursor = lazy(() => import('./ResumeInkCursor'));

interface ResumePayload {
  verified: ResumeAbility[];
  learned: ResumeAbility[];
  awaiting: ResumeAbility[];
}

const EMPTY_RESUME: ResumePayload = { verified: [], learned: [], awaiting: [] };
const EMPTY_PERSONAL_FACTS: PersonalResumeFacts = { name: '', school: '', major: '', certificates: [], professionalSkills: [] };
function scrollToSection(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  const id = event.currentTarget.getAttribute('href')?.slice(1);
  if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

function FadeIn({ children, delay = 0, duration = .7, x = 0, y = 30, className }: {
  children: ReactNode;
  delay?: number;
  duration?: number;
  x?: number;
  y?: number;
  className?: string;
}) {
  return <motion.div className={className} initial={{ opacity: 0, x, y }} whileInView={{ opacity: 1, x: 0, y: 0 }} viewport={{ once: true, margin: '50px', amount: 0 }} transition={{ duration, delay, ease: [.25, .1, .25, 1] }}>{children}</motion.div>;
}

function Magnet({ children }: { children: ReactNode }) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition({ x: (event.clientX - rect.left - rect.width / 2) / 3, y: (event.clientY - rect.top - rect.height / 2) / 3 });
  };
  return <div className="jack-magnet-area" onMouseMove={onMove} onMouseLeave={() => setPosition({ x: 0, y: 0 })}>
    <div className="jack-magnet-content" style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)`, transition: position.x || position.y ? 'transform .3s ease-out' : 'transform .6s ease-in-out' }}>{children}</div>
  </div>;
}

function ContactButton() {
  return <a className="jack-contact-button" href="#jack-services" onClick={scrollToSection}>查看能力</a>;
}

function HeroSection({ nickname, intro }: { nickname: string; intro: string }) {
  return <section className="jack-hero" id="jack-top" aria-labelledby="jack-hero-title">
    <motion.nav className="jack-nav" aria-label="个人网站简历导航" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, ease: [.25, .1, .25, 1] }}>
      <a href="#jack-about" onClick={scrollToSection}>关于我</a>
      <a href="#jack-services" onClick={scrollToSection}>我的能力</a>
      <a href="#jack-projects" onClick={scrollToSection}>已获成就</a>
      <a href="#jack-learning" onClick={scrollToSection}>优势</a>
    </motion.nav>
    <div className="jack-hero-title-clip"><motion.h1 id="jack-hero-title" className="hero-heading" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .15, ease: [.25, .1, .25, 1] }}>Hi, i&apos;m {nickname || 'a learner'}</motion.h1></div>
    <motion.div className="jack-portrait" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .6, ease: [.25, .1, .25, 1] }}><Magnet><img src={PORTRAIT_URL} alt="" /></Magnet></motion.div>
    <div className="jack-hero-bottom">
      <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .35, ease: [.25, .1, .25, 1] }}>{intro}</motion.p>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .5, ease: [.25, .1, .25, 1] }}><ContactButton /></motion.div>
    </div>
  </section>;
}

function MarqueeSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const offset = useMotionValue(0);
  useEffect(() => {
    const update = () => {
      if (!sectionRef.current) return;
      const sectionTop = sectionRef.current.getBoundingClientRect().top + window.scrollY;
      offset.set((window.scrollY - sectionTop + window.innerHeight) * .3);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [offset]);
  const rowRight = useTransform(offset, value => value - 200);
  const rowLeft = useTransform(offset, value => -(value - 200));
  return <section className="jack-marquee" ref={sectionRef} aria-label="视觉素材画廊">
    {[REFERENCE_GIFS.slice(0, 11), REFERENCE_GIFS.slice(11)].map((images, row) => <motion.div className="jack-marquee-row" key={row} style={{ x: row === 0 ? rowRight : rowLeft }}>
      {[...images, ...images, ...images].map((url, index) => <img key={`${row}-${index}`} src={url} loading="lazy" decoding="async" alt="" />)}
    </motion.div>)}
    <span className="jack-marquee-note">视觉素材展示 · 不代表本人作品</span>
  </section>;
}

function RevealCharacter({ char, index, total, progress }: { char: string; index: number; total: number; progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [index / total, Math.min(1, (index + 7) / total)], [.2, 1]);
  return <span className="jack-char" aria-hidden="true"><span className="jack-char-placeholder">{char}</span><motion.span className="jack-char-front" style={{ opacity }}>{char}</motion.span></span>;
}

function AnimatedText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.8', 'end 0.2'] });
  let start = 0;
  return <p ref={ref} className="jack-about-text" aria-label={text}>{(text.match(/[\u3400-\u9fff]|[^\u3400-\u9fff\s]+\s*|\s+/g) ?? []).map((word) => {
    const first = start;
    start += word.length;
    return <span className="jack-word" key={first}>{[...word].map((char, offset) => <RevealCharacter key={offset} char={char} index={first + offset} total={text.length} progress={scrollYProgress} />)}</span>;
  })}</p>;
}

function AboutSection({ nickname, bio, direction, school, major, facts, verified, advantages, profileError, planError }: { nickname: string; bio: string; direction: string; school: string; major: string; facts: PersonalResumeFacts; verified: ResumeAbility[]; advantages: string[]; profileError: boolean; planError: boolean }) {
  return <section className="jack-about" id="jack-about" aria-labelledby="jack-about-title">
    {ABOUT_IMAGES.map((url, index) => <FadeIn key={url} className={`jack-about-image jack-about-image-${index + 1}`} x={index < 2 ? -80 : 80} y={0} delay={[.1, .25, .15, .3][index]} duration={.9}><img src={url} alt="" loading="lazy" /></FadeIn>)}
    <FadeIn y={40}><h2 className="hero-heading" id="jack-about-title">关于我</h2></FadeIn>
    {nickname && <p className="jack-about-profile">昵称：{nickname}</p>}
    <AnimatedText text={profileError && !facts.name && !facts.school && !facts.major && !facts.certificates.length && !facts.professionalSkills.length && !bio && !verified.length ? '个人资料暂时无法读取。' : buildAboutText({ nickname, bio, facts, verified, school, major })} />
    <div className="jack-learning" id="jack-learning" aria-label="学习方向与优势">
      {direction && <div><span>学习方向</span><strong>{direction}</strong></div>}
      <div><span>优势</span>{advantages.length ? <ul className="jack-advantages">{advantages.map(skill => <li key={skill}>{skill}</li>)}</ul> : <strong>{planError ? '课程规划暂时无法读取。' : '课程规划尚未列出专业技能之外的能力。'}</strong>}{advantages.length > 0 && <small>各项掌握状态与作答证据见下方</small>}</div>
    </div>
    <ContactButton />
  </section>;
}

function ServicesSection({ abilities, loading, error }: { abilities: DisplayAbility[]; loading: boolean; error: string }) {
  return <section className="jack-services" id="jack-services" aria-labelledby="jack-services-title">
    <h2 id="jack-services-title">我的能力</h2>
    <div className="jack-services-list">
      {abilities.map((item, index) => <FadeIn key={`${item.status}-${item.phase}-${item.skill}-${index}`} delay={Math.min(index * .1, .5)}>
        <article className="jack-service"><span>{String(index + 1).padStart(2, '0')}</span><div>
          <small>{item.status}</small><h3>{item.skill}</h3><p>{item.description}</p>
          {item.skillPoints.length > 0 && <ul className="jack-service-skills" aria-label={item.status === '待获得' || item.status === '待规划' ? '学完该阶段可获得的技能' : '阶段任务对应的具体技能'}>{item.skillPoints.map(point => <li key={point}>{point}</li>)}</ul>}
          {item.skillPoints.length === 0 && item.status !== '待规划' && <p>当前阶段任务不足以归纳具体技能点。</p>}
          <p className="jack-service-meta">依据：{formatPhaseSource(item.phase)}；作答证据 {item.evidenceCount} 条；{item.masteryPercent == null ? '掌握度暂无数据' : `阶段掌握度 ${item.masteryPercent}%`}。技能点未逐项判分。</p>
        </div></article>
      </FadeIn>)}
      {loading && <p className="jack-service-empty" role="status">正在读取学习能力…</p>}
      {!loading && error && <p className="jack-service-empty" role="alert">{error}</p>}
      {!loading && !error && abilities.every(item => item.status === '待规划') && <p className="jack-service-empty">当前没有课程阶段；设定学习规划后会显示对应的目标技能。</p>}
    </div>
  </section>;
}

function ProjectCard({ pair, index, total, loading, error }: { pair: AchievementPair; index: number; total: number; loading: boolean; error: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const item = pair.ability;
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const targetScale = 1 - (total - 1 - index) * .03;
  const scale = useTransform(scrollYProgress, [0, 1], [1, targetScale]);
  return <div className="jack-project-slot" ref={ref} style={{ top: `${96 + index * 28}px`, zIndex: index + 1 }}>
    <motion.article className="jack-project-card" style={{ scale }}>
      <div className="jack-project-top">
        <strong>{String(index + 1).padStart(2, '0')}</strong>
        <div><span>专业技能 × 学习能力</span>
          <div className="jack-project-pair">
            <div><small>{pair.professionalSource === '用户自填' ? '用户已有技能 · 自填' : '专业相关技能'}</small><b>{pair.professionalSkill || '尚未填写专业技能'}</b></div>
            <div><small>{loading ? '学习记录读取中' : item ? `课程技能 · ${item.status}` : error ? '学习记录读取失败' : '课程技能待规划'}</small><b>{loading ? '正在读取学习记录…' : item?.skill || '尚无对应课程技能'}</b></div>
          </div>
          {!loading && item && <p className="jack-project-meta">{formatPhaseSource(item.phase)} · 作答证据 {item.evidenceCount} 条 · {item.masteryPercent == null ? '掌握度暂无数据' : `掌握度 ${item.masteryPercent}%`}</p>}
          {!loading && item && <p className="jack-project-meta">{item.description}</p>}
        </div>
        <a href="#jack-services" onClick={scrollToSection} className="jack-live-button">查看能力</a>
      </div>
      <div className="jack-project-images" aria-label="装饰性视觉图片，不代表本人作品或作答证据"><div><img src={PROJECT_IMAGES[index][0]} alt="" loading="lazy" /><img src={PROJECT_IMAGES[index][1]} alt="" loading="lazy" /></div><img src={PROJECT_IMAGES[index][2]} alt="" loading="lazy" /></div>
      <p className="jack-project-caption">图片为视觉素材，学习能力与证据以文字记录为准。</p>
    </motion.article>
  </div>;
}

function ProjectsSection({ pairs, loading, error }: { pairs: AchievementPair[]; loading: boolean; error: string }) {
  return <section className="jack-projects" id="jack-projects" aria-labelledby="jack-projects-title">
    <h2 className="hero-heading" id="jack-projects-title">已获成就</h2>
    <p className="jack-projects-note">每张卡片对应一项专业技能与一项课程技能；学习状态以卡片标注为准，待获得内容不代表已取得成就。</p>
    {pairs.map((pair, index) => <ProjectCard key={`${pair.professionalSkill}-${pair.ability?.phase}-${index}`} pair={pair} index={index} total={3} loading={loading} error={error} />)}
  </section>;
}

export default function PersonalWebsiteResume({ onBack }: { onBack?: () => void }) {
  const [profile, setProfile] = useState<BasicProfile | null>(null);
  const [personalFacts, setPersonalFacts] = useState<PersonalResumeFacts>(EMPTY_PERSONAL_FACTS);
  const [phases, setPhases] = useState<LatestPlanResponse['phases']>([]);
  const [phaseTasks, setPhaseTasks] = useState<Record<string, DailyTask[]>>({});
  const [resume, setResume] = useState<ResumePayload>(EMPTY_RESUME);
  const [loading, setLoading] = useState(true);
  const [resumeLoaded, setResumeLoaded] = useState(false);
  const [error, setError] = useState('');
  const [profileError, setProfileError] = useState(false);
  const [planError, setPlanError] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.allSettled([
      fetchBasicProfile(),
      fetchLatestPlan(),
      fetchResumeDocument(),
    ]).then(([profileResult, planResult, documentResult]) => {
      if (!alive) return;
      if (profileResult.status === 'fulfilled') setProfile(profileResult.value);
      else setProfileError(true);
      if (planResult.status === 'fulfilled') {
        setPhases(planResult.value.phases);
        void Promise.allSettled(planResult.value.phases.map(phase => fetchPhaseTasks(phase.id))).then(results => {
          if (!alive) return;
          setPhaseTasks(Object.fromEntries(results.flatMap((result, index) => result.status === 'fulfilled'
            ? [[planResult.value.phases[index].id, result.value.tasks] as const]
            : [])));
        });
      }
      else setPlanError(true);
      if (documentResult.status === 'fulfilled') setPersonalFacts(readPersonalResumeFacts(documentResult.value?.payload ?? null));
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    let pending = false;
    let hasSucceeded = false;
    const refreshResume = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await apiRequest<ResumePayload>('/api/resume');
        if (!alive) return;
        setResume(next);
        setResumeLoaded(true);
        setError('');
        hasSucceeded = true;
      } catch {
        if (alive) setError(hasSucceeded ? '学习记录自动更新失败，当前显示上次结果。' : '暂时无法读取学习能力，请稍后重试。');
      } finally {
        pending = false;
        if (alive) setLoading(false);
      }
    };
    void refreshResume();
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void refreshResume(); };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    const timer = window.setInterval(refreshWhenVisible, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${profile?.nickname?.trim() || '个人网站简历'} -- StudyPilot`;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onBack?.(); };
    window.addEventListener('keydown', escape);
    return () => { document.title = previousTitle; window.removeEventListener('keydown', escape); };
  }, [onBack, profile?.nickname]);
  const abilities = buildDisplayAbilities(resume, phases, phaseTasks);
  const achievementPairs = buildAchievementPairs(personalFacts, profile?.major || '', abilities);
  const advantages = buildAdvantages(phases, personalFacts.professionalSkills);
  return <main className="jack-site">
    <Suspense fallback={null}><ResumeInkCursor /></Suspense>
    <HeroSection nickname={profile?.nickname?.trim() || ''} intro={loading ? '正在读取已验证能力…' : error && !resumeLoaded ? '暂时无法读取学习进度' : buildResumeHeroSummary(resume.verified)} />
    <MarqueeSection />
    <AboutSection nickname={profile?.nickname?.trim() || ''} bio={profile?.bio?.trim() || ''} direction={profile?.direction?.trim() || ''} school={profile?.school?.trim() || ''} major={profile?.major?.trim() || ''} facts={personalFacts} verified={resume.verified} advantages={advantages} profileError={profileError} planError={planError} />
    <ServicesSection abilities={abilities} loading={loading} error={error} />
    <ProjectsSection pairs={achievementPairs} loading={loading} error={error} />
  </main>;
}
