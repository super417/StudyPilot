import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import PostcardsRoute from './PostcardsRoute';
import PricingPostcardStack from './overview/PricingPostcardStack';
import { buildPostcardsOverview, type PostcardsOverview, type OverviewAction } from '@/lib/postcardsOverview';
import 'lenis/dist/lenis.css';
import './StudyPilotPostcards.css';
import { OVERVIEW_NAVIGATION_EVENT } from '@/lib/overviewNavigation';

gsap.registerPlugin(ScrollTrigger);

const postcards = [
  ['01-hello.jpg', '你好'], ['02-roadmap.jpg', '星藤航图'], ['03-checkin.jpg', '打卡'],
  ['04-mistakes.jpg', '错题'], ['05-weekly-review.jpg', '周复盘'], ['06-agent.jpg', 'Agent'],
  ['07-focus.jpg', '专注'], ['08-encourage.jpg', '鼓励'], ['09-overview.jpg', '总览'],
];
interface DisplayPlan {
  name: string; monthly: string; annual: string; color: string; note: string; features: string[];
  suffix?: string; annualSuffix?: string; action?: OverviewAction; cta?: string;
  reason?: string; secondaryAction?: OverviewAction; secondaryLabel?: string;
}

function Arrow() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.4" /></svg>;
}

function BotMark() {
  return <svg viewBox="0 0 50 33" aria-hidden="true"><rect width="49" height="32" rx="9" fill="currentColor" /><path d="M12 14h26v7H12z" fill="#fffefc" /><circle cx="18" cy="20" r="4" fill="currentColor" /><circle cx="31" cy="20" r="4" fill="currentColor" /></svg>;
}

function CardDeck({ className = '', decorative = false }: { className?: string; decorative?: boolean }) {
  return <div className={`spp-deck ${className}`} aria-label={decorative ? undefined : '九张水彩明信片'} aria-hidden={decorative || undefined}>
    {postcards.map(([file, title], index) => <figure key={file} className="spp-postcard" style={{ zIndex: postcards.length - index }}>
      <div className="spp-postcard-face"><img src={`/postcards/${file}`} alt={decorative ? '' : `StudyPilot 水彩明信片：${title}`} width="864" height="1152" decoding="async" loading={decorative ? 'lazy' : 'eager'} /></div>
    </figure>)}
  </div>;
}

function StudyPilotPostcards({ overview, onAction, onRetry }: { overview: PostcardsOverview; onAction?: (action: OverviewAction) => void; onRetry?: () => void }) {
  const rootRef = useRef<HTMLElement>(null);
  const floatingRef = useRef<HTMLElement>(null);
  const lenisRef = useRef<Lenis | null>(null);
  const [annual, setAnnual] = useState(false);
  const content = buildPostcardsOverview(overview, annual ? 'weekly' : 'today');
  const displayedPlans: DisplayPlan[] = content.plans;
  const act = (action: OverviewAction) => onAction?.(action);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const media = gsap.matchMedia();
    const hero = root.querySelector<HTMLElement>('.spp-hero-main')!;
    const ending = root.querySelector<HTMLElement>('.spp-ending')!;
    let lastDirectionY = window.scrollY;
    let scrollingUp = false;
    let lastStickyTop = -1;
    const lenis = reduced ? null : new Lenis({
      autoRaf: false, lerp: .1,
      virtualScroll: ({ event }) => event.target instanceof Node && root.contains(event.target),
      prevent: (node) => !!node.closest('[role="dialog"], [data-lenis-prevent]'),
    });
    lenisRef.current = lenis;
    lenis?.on('scroll', ScrollTrigger.update);
    const openOverview = (event: Event) => {
      const target = document.getElementById('learning-overview');
      if (!target) return;
      event.preventDefault();
      if (lenis) lenis.scrollTo(target, { immediate: true, force: true });
      else target.scrollIntoView({ behavior: 'instant', block: 'start' });
    };
    window.addEventListener(OVERVIEW_NAVIGATION_EVENT, openOverview);

    const strips = [...root.querySelectorAll<HTMLElement>('.spp-deck')].map((element) => ({
      element,
      cards: [...element.querySelectorAll<HTMLElement>('.spp-postcard')],
      positions: postcards.map((_, index) => index * 150),
      rotations: postcards.map(() => 0),
    }));

    const draw = (time: number) => {
      lenis?.raf(time * 1000);
      const mobile = window.innerWidth < 768;
      const scale = mobile ? .5 : 1;
      const spacing = mobile ? 115 : 150;
      const heroRect = hero.getBoundingClientRect();
      const heroProgress = Math.max(0, Math.min(1, -heroRect.top / window.innerHeight));
      const footerRect = ending.getBoundingClientRect();
      const footerProgress = Math.max(0, Math.min(1, (window.innerHeight - footerRect.top) / (window.innerHeight + footerRect.height)));
      strips.forEach((strip, stripIndex) => {
        const isHero = stripIndex === 0;
        const travel = isHero ? -heroProgress * 720 * scale : (footerProgress - .5) * 460 * scale;
        const base = (index: number) => index * spacing * scale;
        const length = base(postcards.length - 1);
        strip.cards.forEach((card, index) => {
          const target = index === 0 ? travel : strip.positions[index - 1] + spacing * scale;
          const previous = strip.positions[index];
          const position = reduced ? base(index) : previous + (target - previous) * (index === 0 ? .45 : .4);
          strip.positions[index] = position;
          const bend = (1 - Math.pow(2 * Math.max(-.5, Math.min(.5, (position - length / 2) / Math.max(1, length))), 2)) * 130 * scale;
          const x = position * Math.cos(24 * Math.PI / 180);
          const y = -position * Math.sin(24 * Math.PI / 180) + bend - (index - 4) * 20 * scale;
          const tilt = Math.max(-14, Math.min(14, (position - previous) * .55));
          strip.rotations[index] += (tilt - strip.rotations[index]) * .12;
          card.style.transform = `translate3d(${x}px,${y}px,0) rotate(${reduced ? 0 : strip.rotations[index]}deg)`;
        });
      });

      const y = window.scrollY;
      if (Math.abs(y - lastDirectionY) > 5) { scrollingUp = y < lastDirectionY; lastDirectionY = y; }
      const bounds = root.getBoundingClientRect();
      const floating = floatingRef.current;
      if (floating) floating.hidden = !(bounds.top < -180 && bounds.bottom > 100 && scrollingUp && window.innerWidth >= 768);
      const stickyTop = floating && !floating.hidden ? Math.max(0, floating.getBoundingClientRect().bottom) : 0;
      if (stickyTop !== lastStickyTop) {
        root.style.setProperty('--spp-card-sticky-top', `${stickyTop}px`);
        lastStickyTop = stickyTop;
      }
    };

    const context = gsap.context(() => {
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('.spp-hero-copy > *', { y: 25, opacity: 0, duration: .8, stagger: .12, ease: 'power3.out', scrollTrigger: { trigger: '.spp-hero', start: 'top 70%', once: true } });
        const lines = gsap.utils.toArray<HTMLElement>('.spp-title-line', root);
        const reveal = gsap.timeline({ scrollTrigger: { trigger: '.spp-route-canvas', start: 'top 80%', once: true } });
        lines.forEach((line, index) => reveal.from(line, { yPercent: 110, duration: .9, ease: 'power4.out' }, index < 2 ? index * .16 : 1.18 + (index - 2) * .16));
        gsap.to('.spp-hero-grid', { backgroundPositionY: 150, ease: 'none', scrollTrigger: { trigger: '.spp-hero', start: 'top top', end: 'bottom top', scrub: true } });
      });
    }, root);
    gsap.ticker.add(draw);
    const refresh = () => ScrollTrigger.refresh();
    const images = [...root.querySelectorAll('img')];
    images.forEach((image) => image.addEventListener('load', refresh));
    void document.fonts.ready.then(() => { if (root.isConnected) refresh(); });
    refresh();
    return () => {
      window.removeEventListener(OVERVIEW_NAVIGATION_EVENT, openOverview);
      images.forEach((image) => image.removeEventListener('load', refresh));
      gsap.ticker.remove(draw);
      root.style.removeProperty('--spp-card-sticky-top');
      lenis?.destroy();
      lenisRef.current = null;
      media.revert();
      context.revert();
    };
  }, []);

  const goTo = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    if (lenisRef.current) lenisRef.current.scrollTo(target, { duration: 1.1, offset: -75 });
    else target.scrollIntoView({ behavior: 'instant', block: 'start' });
  };
  const nav = (floating = false) => <header ref={floating ? floatingRef : undefined} className={`spp-nav ${floating ? 'spp-floating-nav' : ''}`} hidden={floating || undefined}>
    <button className="spp-wordmark" type="button" onClick={() => goTo('overview-content')}>STUDYPILOT</button>
    <nav aria-label={floating ? '滚动页面导航' : '明信片页面导航'}>
      {(['学习目标', '学习流程', '我的学习', '学习路线', '习题本', '学习周报', '今日任务']).map((label, index) => <button type="button" key={label} onClick={() => {
        if (index === 1 || index === 2) goTo(index === 2 ? 'postcard-pricing' : 'postcard-process');
        else if (content) act((['goal', 'goal', 'goal', 'roadmap', 'mistakes', 'weekly', 'tasks'] as OverviewAction[])[index]);
        else goTo('learning-overview');
      }}>{label}</button>)}
    </nav>
    <div className="spp-nav-actions"><button className="spp-button" type="button" onClick={() => act('checkin')}>{'今日打卡'}</button><button className="spp-button spp-button-lime" type="button" onClick={() => act('start')}>{'开始学习'}</button></div>
  </header>;

  return <>
    <section ref={rootRef} className="spp-root" aria-label={'StudyPilot 学习总览'}>
      <section className="spp-hero" aria-labelledby="spp-hero-heading">
        {nav()}
        <div className="spp-hero-main">
          <div className="spp-hero-grid" aria-hidden="true" />
          <div className="spp-container spp-hero-content">
            <div className="spp-hero-copy">
              <span className="spp-eyebrow">{content?.eyebrow ?? 'NOW AVAILABLE — REST API'}</span>
              <h2 id="spp-hero-heading">{<>把目标变成方向<br />让今天量力而行</>}</h2>
              <p className="spp-hero-description" title={content?.description}>{content.description.slice(0, 85) + (content.description.length > 85 ? '…' : '')}</p>
              <p className="spp-hero-highlight" title={content?.highlight}>{content.highlight.slice(0, 65) + (content.highlight.length > 65 ? '…' : '')}</p>
              <div className="spp-hero-actions"><button className="spp-button spp-button-lime" type="button" onClick={() => act('start')}>{'开始今天的学习'} <Arrow /></button><button className="spp-button" type="button" onClick={() => act('goal')}>{'查看我的目标'}</button></div>
            </div>
          </div>
          <CardDeck className="spp-hero-deck" />
        </div>
        <div className="spp-index-strip">{(content.stats).map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
      </section>

      <section id="postcard-process" className="spp-process" aria-labelledby="spp-process-heading">
        <div className="spp-container">
          <div className="spp-route-canvas">
            <h2 id="spp-process-heading" className={`spp-process-heading${' spp-process-calligraphy spp-process-calligraphy-goal'}`}><span className="spp-title-mask"><span className="spp-title-line">{'从目标'}</span></span><span className="spp-title-mask"><span className="spp-title-line">{'到行动'}</span></span></h2>
            <PostcardsRoute />
            <h2 className={`spp-process-finish${' spp-process-calligraphy spp-process-calligraphy-feedback'}`}><span className="spp-title-mask"><span className="spp-title-line">{'练习与反馈'}</span></span><span className="spp-title-mask"><span className="spp-title-line">{'稳步向前。'}</span></span></h2>
          </div>
          <div className="spp-process-caption"><p>{'从学习目标展开阶段路线，把路线落到今天选好的任务。练习、错题与打卡留下真实记录，再根据反馈决定下一步；需要调整时，先看预览，再由你确认。'}</p><button className="spp-button spp-button-lime" type="button" onClick={() => act('roadmap')}>{'展开完整学习路线'} <Arrow /></button></div>
        </div>
      </section>


      <section id="postcard-pricing" className="spp-pricing" aria-labelledby="spp-pricing-heading">
        <div className="spp-container">
          <header className="spp-pricing-heading"><h2 id="spp-pricing-heading">{'看见今天，也看见下一步'}</h2><p>{'今日任务、知识掌握与回顾复盘，都来自你的学习记录。先选今天能做的量，完成后再留下反馈。'}</p><div className="spp-billing-switch" data-annual={annual} role="group" aria-label={'学习记录范围'}><span className="spp-billing-slider" aria-hidden="true" /><button type="button" aria-pressed={!annual} aria-label={'今日概览'} onClick={() => setAnnual(false)}>{'今日概览'}</button><button type="button" aria-pressed={annual} aria-label={'最近周报'} onClick={() => setAnnual(true)}>{'最近周报'}</button></div></header>
          {content && overview?.ready && (overview.error || overview.unavailable.length > 0) && <div role="alert" className="spp-record-warning"><p>{overview.error || '部分学习记录暂时无法读取，缺失数据不会记为零。'}</p><button className="spp-button" type="button" onClick={onRetry}>重新读取记录</button></div>}
          <div className={"spp-plans spp-learning-plans"} aria-busy={!overview?.ready}>{displayedPlans.map((plan, index) => <article className={`spp-plan spp-plan-${plan.color}`} key={plan.name}>
            <p className="spp-plan-index">{'学习环节'} {index + 1}</p>
            <div className="spp-plan-body">
              {index === 1 && <div className="spp-popular"><BotMark /><span style={{ whiteSpace: 'nowrap' }}>{'学习证据'}</span></div>}
              <header><h3>{plan.name}</h3><p className="spp-price"><strong>{annual ? plan.annual : plan.monthly}</strong>{plan.suffix ? <span>{annual ? plan.annualSuffix : plan.suffix}</span> : index > 0 && <span>{annual ? 'year' : 'month'}</span>}</p><p className="spp-plan-note">{plan.note}</p></header>
              {content && <div className="spp-learning-action"><button className="spp-button" type="button" disabled={!overview?.ready} onClick={() => plan.action && act(plan.action)}>{plan.cta} <Arrow /></button>{plan.secondaryAction && <button className="spp-learning-secondary" type="button" disabled={!overview?.ready} onClick={() => act(plan.secondaryAction!)}>{plan.secondaryLabel}</button>}</div>}
              <div className="spp-plan-features"><ul>{plan.features.map((feature, featureIndex) => <li key={featureIndex}><span aria-hidden="true">{'·'}</span>{feature}</li>)}</ul></div>
              {content && <p className="spp-learning-reason">{plan.reason}</p>}
              {!content && <div className="spp-plan-bottom"><button className="spp-button" type="button" onClick={() => plan.action ? act(plan.action) : goTo('learning-overview')}>{plan.cta ?? 'START SENDING'} <Arrow /></button></div>}
            </div>
          </article>)}</div>
        </div>
      </section>

      <section className="spp-ending spp-ending-pricing" aria-labelledby="spb-heading">
        <CardDeck className="spp-ending-deck spp-ending-deck-top" decorative /><CardDeck className="spp-ending-deck spp-ending-deck-bottom" decorative /><div className="spp-ending-scrim" aria-hidden="true" />
        <PricingPostcardStack />
      </section>
      <footer className="spp-footer"><div className="spp-container spp-footer-grid"><div><span className="spp-footer-logo">STUDYPILOT</span><h3>{'智航 · AI 微专业能力航图'}</h3><p>{'把目标、阶段路线、今日任务、练习记录和复盘反馈放在同一条学习路线上。'}</p><small>© 2026 StudyPilot. All rights reserved.<br />{'记录与反馈，让下一步有据可依。'}</small></div><div className="spp-footer-links"><div><span>{'学习工具'}</span>{(['完整路线', '我的习题本', '学习周报', '个人中心']).map((label, index) => <button type="button" key={label} onClick={() => act((['roadmap', 'mistakes', 'weekly', 'profile'] as OverviewAction[])[index])}>{label}</button>)}</div><div><span>STUDYPILOT</span>{(['学习目标', '今日任务', '今日打卡']).map((label, index) => <button type="button" key={label} onClick={() => act((['goal', 'tasks', 'checkin'] as OverviewAction[])[index])}>{label}</button>)}</div><div className="spp-connect"><span>{'下一步'}</span><p>{'从一个真实目标开始。'}</p>{!content && <div className="spp-socials"><span>in</span><span>𝕏</span><span>◎</span></div>}</div></div></div></footer>
    </section>
    {!content && <p className="spp-reference-note">本段沿用 MailerBot 参考展示内容；邮寄数据及方案不代表 StudyPilot 的实际服务或收费。</p>}
    {createPortal(nav(true), document.body)}
  </>;
}

export default StudyPilotPostcards;
