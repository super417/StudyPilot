import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './PricingPostcardStack.css';

gsap.registerPlugin(ScrollTrigger);

const imageRoot = '/postcards/pricing/';
const art = (group: string, extension = 'jpg') => `${imageRoot}${group}/main.${extension}`;

export const PRICING_POSTCARDS = [
  { id: 'qihang', name: '起航版', category: '免费起航', price: '免费', detail: '基础可用，无订阅。', image: art('01-qihang-envelope'),
    blurb: '目标、路线、任务、打卡与学习记录，让每一步都有着落。',
    features: ['学习目标与阶段路线', '今日任务与打卡', '保留自己的学习记录'],
    back: [art('02-voyage-map-letter'), art('03-checkin-stamp'), art('07-study-journal'), art('11-celebrate-step', 'png')] },
  { id: 'linghang', name: '领航版', category: '会员月付', price: '¥30 / 月', detail: '每月含 __ 点 AI 额度。', image: art('05-linghang-member'),
    blurb: '用 AI 额度获得规划、诊断与深度复盘；使用前先看本次消耗。',
    features: ['AI 学习规划', '学习诊断与深度复盘', '使用前显示本次消耗'],
    back: [art('04-ai-helper'), art('08-deep-review'), art('12-diagnose-report', 'png'), art('10-own-api-key')] },
  { id: 'supply', name: '补给包', category: '按需补给', price: '¥5 / 包', detail: '每包含 __ 点 AI 额度。', image: art('06-supply-pack'),
    blurb: '偶尔需要更多 AI 时，补一份刚刚好的助力，无须长期订阅。',
    features: ['按需购买补充额度', '适合偶尔增加 AI 用量', '无须长期订阅'],
    back: [art('09-task-flags'), art('13-mistake-redo'), art('14-weekly-review')] },
] as const;

type Tier = typeof PRICING_POSTCARDS[number];

function PricingDetails({ initial, onClose }: { initial: number; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(initial);
  const [capability, setCapability] = useState('AI 学习规划');
  const [showEstimate, setShowEstimate] = useState(false);
  const tier = PRICING_POSTCARDS[selected];
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<dialog ref={dialogRef} className="spb-dialog" aria-label="StudyPilot 计费方案说明" onCancel={onClose}>
    <header><div><span>STUDYPILOT · 学习补给</span><h2>选择适合自己的助力</h2></div><button type="button" onClick={onClose} aria-label="关闭计费说明">×</button></header>
    <div className="spb-detail-tabs" role="group" aria-label="查看计费档位">{PRICING_POSTCARDS.map((item, index) => <button type="button" key={item.id} aria-pressed={selected === index} onClick={() => { setSelected(index); setShowEstimate(false); }}>{item.name}</button>)}</div>
    <div className="spb-detail-heading"><h3>{tier.name}</h3><strong>{tier.price}</strong></div>
    <p>{tier.detail}</p><p>{tier.blurb}</p><ul>{tier.features.map((item) => <li key={item}>{item}</li>)}</ul>
    {selected > 0 && <div className="spb-consumption"><label>AI 能力消耗示例<select value={capability} onChange={(event) => { setCapability(event.target.value); setShowEstimate(false); }}>{['AI 学习规划', '学习诊断', '深度复盘'].map((item) => <option key={item}>{item}</option>)}</select></label><button type="button" onClick={() => setShowEstimate(true)}>查看本次消耗</button>{showEstimate && <p role="status">{capability}：本次约消耗 __ 点。额度待测算，当前仅展示使用前确认的样式。</p>}</div>}
    <p className="spb-key-rule">自带 API Key：沿用自己的模型，不重复扣平台额度。</p>
    <p className="spb-detail-note">额度待测算 · 当前仅展示方案，尚未开放购买。</p>
  </dialog>, document.body);
}

function TierPostcard({ tier, index, onDetails }: { tier: Tier; index: number; onDetails: () => void }) {
  return <article className={`spb-tier spb-tier-${tier.id}`} aria-labelledby={`spb-tier-${tier.id}`}>
    <h3 className="spb-tier-tab" id={`spb-tier-${tier.id}`}>{tier.name}<span>{tier.category}</span></h3>
    <div className="spb-tier-frame">
      <div className="spb-scene" aria-label={`${tier.name}水彩明信片叠层`}>
        <div className="spb-stack-motion">
          {tier.back.map((src, depth) => <figure className="spb-art-card" key={src} style={{ '--spb-layer': depth, '--spb-x': `${-94 + depth * 43}px`, '--spb-z': `${depth * 14}px` } as CSSProperties}>
            <img src={src} width="864" height="1152" alt="" loading="lazy" decoding="async" />
          </figure>)}
          <div className="spb-front" style={{ '--spb-x': '85px', '--spb-z': '80px' } as CSSProperties}>
            <div className="spb-front-copy"><span>STUDYPILOT</span><h4>{tier.name}</h4><strong>{tier.price}</strong><p>{index === 1 ? '规划 · 诊断\n深度复盘' : index === 0 ? '从今天出发\n每一步都算数' : '需要时补一点\n按自己的节奏'}</p><span className="spb-front-seal">{index === 1 ? '会员 AI 额度' : index === 0 ? '基础能力免费' : '无须长期订阅'}</span></div>
            <div className="spb-front-art"><img src={tier.image} alt={`StudyPilot ${tier.name}水彩信件`} width="864" height="1152" loading="lazy" decoding="async" />{index === 1 && <img className="spb-owl-stamp" src={art('04-ai-helper')} alt="可爱的 AI 学习伙伴猫头鹰" width="864" height="1152" loading="lazy" />}</div>
          </div>
        </div>
      </div>
      <div className="spb-tier-bottom"><p>{tier.blurb}</p><button type="button" onClick={onDetails} aria-label={`了解${tier.name}计费`}>了解计费 <span aria-hidden="true">↗</span></button></div>
    </div>
  </article>;
}

export default function PricingPostcardStack() {
  const rootRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; scroll: number; moved: boolean } | null>(null);
  const [details, setDetails] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!rootRef.current) return;
    // A reload may restore nested scroll positions; the first tier always starts centered.
    const initialFrame = window.requestAnimationFrame(() => railRef.current?.scrollTo({ left: 0, behavior: 'instant' }));
    const media = gsap.matchMedia();
    const context = gsap.context(() => {
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo('.spb-stack-motion', { x: -18, y: 12, rotateY: -5 }, { x: 18, y: -12, rotateY: 5, ease: 'none', scrollTrigger: { trigger: rootRef.current, start: 'top bottom', end: 'bottom top', scrub: .6 } });
      });
    }, rootRef);
    return () => { window.cancelAnimationFrame(initialFrame); media.revert(); context.revert(); };
  }, []);
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || (event.target as HTMLElement).closest('button, a')) return;
    drag.current = { x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: false };
  };
  return <div ref={rootRef} id="study-pricing" className="spb-section">
    <div className="spb-section-heading"><span>STUDYPILOT · PRICING POSTCARDS</span><h2 id="spb-heading">给下一程，刚刚好的助力</h2></div>
    <div ref={railRef} className="spb-tier-rail" tabIndex={0} role="group" aria-label="三档计费明信片，按住鼠标左键左右拖动，或使用左右方向键" onScroll={(event) => {
      const rail = event.currentTarget;
      const step = (rail.firstElementChild?.getBoundingClientRect().width ?? rail.clientWidth) + 48;
      setActive(Math.max(0, Math.min(2, Math.round(rail.scrollLeft / step))));
    }} onKeyDown={(event) => {
      if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const step = (event.currentTarget.firstElementChild?.getBoundingClientRect().width ?? event.currentTarget.clientWidth) + 48;
      event.currentTarget.scrollBy({ left: event.key === 'ArrowRight' ? step : -step, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }} onPointerDown={pointerDown} onPointerMove={(event) => {
      const active = drag.current;
      if (!active) return;
      const distance = event.clientX - active.x;
      if (Math.abs(distance) > 5) { active.moved = true; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.classList.add('spb-dragging'); event.currentTarget.scrollLeft = active.scroll - distance; }
    }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; event.currentTarget.classList.remove('spb-dragging'); }} onPointerCancel={() => { drag.current = null; railRef.current?.classList.remove('spb-dragging'); }} onPointerLeave={() => { if (!railRef.current?.classList.contains('spb-dragging')) drag.current = null; }}>
      {PRICING_POSTCARDS.map((tier, index) => <TierPostcard tier={tier} index={index} key={tier.id} onDetails={() => setDetails(index)} />)}
    </div>
    <p className="spb-drag-hint"><span>按住左键左右拖动 · 触屏可滑动</span><span aria-live="polite">{active + 1} / 3</span></p>
    <div className="spb-bottom-bar"><p>StudyPilot：基础免费 · 会员含 AI 额度 · 按需补给包。<span>自带 Key 不重复扣平台额度。</span></p><button type="button" onClick={() => setDetails(1)}>了解计费 <span aria-hidden="true">↗</span></button></div>
    <a className="spb-back-to-learning" href="#overview-content">回到学习总览 ↑</a>
    {details !== null && <PricingDetails initial={details} onClose={() => setDetails(null)} />}
  </div>;
}
