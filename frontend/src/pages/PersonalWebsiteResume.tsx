import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { motion, useMotionValue, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { ABOUT_IMAGES, PORTRAIT_URL, PROJECT_IMAGES, REFERENCE_GIFS } from './jackPortfolioAssets';
import './PersonalWebsiteResume.css';

const SERVICES = [
  { name: '3D Modeling', description: 'Creation of detailed objects, characters, or environments tailored to specific client needs, ideal for games, products, and visualizations.' },
  { name: 'Rendering', description: 'High-quality, photorealistic renders that showcase designs with custom lighting, textures, and materials to bring concepts to life.' },
  { name: 'Motion Design', description: 'Dynamic animations and motion graphics that add energy and storytelling to brands, products, and digital experiences.' },
  { name: 'Branding', description: 'Crafting cohesive visual identities — from logos to full brand systems — that communicate a clear and memorable presence.' },
  { name: 'Web Design', description: 'Designing clean, modern, and conversion-focused websites with attention to layout, typography, and user experience.' },
];

const PROJECTS = [
  { name: 'Nextlevel Studio', category: 'Client', images: PROJECT_IMAGES[0] },
  { name: 'Aura Brand Identity', category: 'Personal', images: PROJECT_IMAGES[1] },
  { name: 'Solaris Digital', category: 'Client', images: PROJECT_IMAGES[2] },
];

const ABOUT_TEXT = "With more than five years of experience in design, i focus on branding, web design, and user experience, i truly enjoy working with businesses that aim to stand out and present their best image. Let's build something incredible together!";

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
  return <a className="jack-contact-button" href="#jack-contact" onClick={scrollToSection}>Contact Me</a>;
}

function HeroSection() {
  return <section className="jack-hero" id="jack-top" aria-labelledby="jack-hero-title">
    <motion.nav className="jack-nav" aria-label="Portfolio navigation" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, ease: [.25, .1, .25, 1] }}>
      <a href="#jack-about" onClick={scrollToSection}>About</a>
      <a href="#jack-services" onClick={scrollToSection}>Price</a>
      <a href="#jack-projects" onClick={scrollToSection}>Projects</a>
      <a href="#jack-contact" onClick={scrollToSection}>Contact</a>
    </motion.nav>
    <div className="jack-hero-title-clip"><motion.h1 id="jack-hero-title" className="hero-heading" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .15, ease: [.25, .1, .25, 1] }}>Hi, i&apos;m jack</motion.h1></div>
    <motion.div className="jack-portrait" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .6, ease: [.25, .1, .25, 1] }}><Magnet><img src={PORTRAIT_URL} alt="" /></Magnet></motion.div>
    <div className="jack-hero-bottom">
      <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .35, ease: [.25, .1, .25, 1] }}>A 3D creator driven by crafting striking and unforgettable projects</motion.p>
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
  return <section className="jack-marquee" ref={sectionRef} aria-label="Visual portfolio gallery">
    {[REFERENCE_GIFS.slice(0, 11), REFERENCE_GIFS.slice(11)].map((images, row) => <motion.div className="jack-marquee-row" key={row} style={{ x: row === 0 ? rowRight : rowLeft }}>
      {[...images, ...images, ...images].map((url, index) => <img key={`${row}-${index}`} src={url} loading="lazy" decoding="async" alt="" />)}
    </motion.div>)}
  </section>;
}

function RevealCharacter({ char, index, total, progress }: { char: string; index: number; total: number; progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [index / total, Math.min(1, (index + 7) / total)], [.2, 1]);
  return <span className="jack-char"><span className="jack-char-placeholder" aria-hidden="true">{char}</span><motion.span className="jack-char-front" style={{ opacity }}>{char}</motion.span></span>;
}

function AnimatedText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.8', 'end 0.2'] });
  let start = 0;
  return <p ref={ref} className="jack-about-text">{(text.match(/\S+\s*/g) ?? []).map((word) => {
    const first = start;
    start += word.length;
    return <span className="jack-word" key={first}>{[...word].map((char, offset) => <RevealCharacter key={offset} char={char} index={first + offset} total={text.length} progress={scrollYProgress} />)}</span>;
  })}</p>;
}

function AboutSection() {
  return <section className="jack-about" id="jack-about" aria-labelledby="jack-about-title">
    {ABOUT_IMAGES.map((url, index) => <FadeIn key={url} className={`jack-about-image jack-about-image-${index + 1}`} x={index < 2 ? -80 : 80} y={0} delay={[.1, .25, .15, .3][index]} duration={.9}><img src={url} alt="" loading="lazy" /></FadeIn>)}
    <FadeIn y={40}><h2 className="hero-heading" id="jack-about-title">About me</h2></FadeIn>
    <AnimatedText text={ABOUT_TEXT} />
    <ContactButton />
  </section>;
}

function ServicesSection() {
  return <section className="jack-services" id="jack-services" aria-labelledby="jack-services-title">
    <h2 id="jack-services-title">Services</h2>
    <div className="jack-services-list">{SERVICES.map((item, index) => <FadeIn key={item.name} delay={index * .1}>
      <article className="jack-service"><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{item.name}</h3><p>{item.description}</p></div></article>
    </FadeIn>)}</div>
  </section>;
}

function ProjectCard({ project, index, total }: { project: typeof PROJECTS[number]; index: number; total: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const targetScale = 1 - (total - 1 - index) * .03;
  const scale = useTransform(scrollYProgress, [0, 1], [1, targetScale]);
  return <div className="jack-project-slot" ref={ref} style={{ top: `${96 + index * 28}px`, zIndex: index + 1 }}>
    <motion.article className="jack-project-card" style={{ scale }}>
      <div className="jack-project-top">
        <strong>{String(index + 1).padStart(2, '0')}</strong>
        <div><span>{project.category}</span><h3>{project.name}</h3></div>
        <button type="button" className="jack-live-button" aria-label={`${project.name} design preview`}>Live Project</button>
      </div>
      <div className="jack-project-images"><div><img src={project.images[0]} alt="" loading="lazy" /><img src={project.images[1]} alt="" loading="lazy" /></div><img src={project.images[2]} alt="" loading="lazy" /></div>
    </motion.article>
  </div>;
}

function ProjectsSection() {
  return <section className="jack-projects" id="jack-projects" aria-labelledby="jack-projects-title">
    <h2 className="hero-heading" id="jack-projects-title">Project</h2>
    {PROJECTS.map((project, index) => <ProjectCard key={project.name} project={project} index={index} total={PROJECTS.length} />)}
    <span id="jack-contact" className="jack-contact-anchor" />
  </section>;
}

export default function PersonalWebsiteResume({ onBack }: { onBack?: () => void }) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Jack -- 3D Creator';
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onBack?.(); };
    window.addEventListener('keydown', escape);
    return () => { document.title = previousTitle; window.removeEventListener('keydown', escape); };
  }, [onBack]);
  return <main className="jack-site">
    <span className="sr-only">Jack portfolio design demonstration. The sample projects and biography are not the signed-in user's resume.</span>
    <HeroSection />
    <MarqueeSection />
    <AboutSection />
    <ServicesSection />
    <ProjectsSection />
  </main>;
}
