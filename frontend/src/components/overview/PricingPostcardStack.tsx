import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './PricingPostcardStack.css';
import PlatformBillingCard from '@/components/profile/PlatformBillingCard';

gsap.registerPlugin(ScrollTrigger);

const imageRoot = '/postcards/pricing/';
const art = (group: string, extension = 'jpg') => `${imageRoot}${group}/main.${extension}`;

export const PRICING_POSTCARDS = [
  { id: 'qihang', name: '免费版', category: '每月 500 积分', price: '免费', detail: '基础学习功能免费，每个自然月发放 500 积分，当月有效、不结转。', image: art('01-qihang-envelope'),
    blurb: '从目标到任务，留下真实学习记录。', features: ['学习目标与阶段路线', '今日任务、练习与学习记录', '每月 500 积分，按模型实际用量消耗'],
    back: [art('02-voyage-map-letter'), art('03-checkin-stamp'), art('07-study-journal'), art('11-celebrate-step', 'png')] },
  { id: 'linghang', name: '启航版', category: '活动每月 4,000 积分', price: '¥99 / 月', detail: '单月 99 元；连续包月 70 元；连续包年 672 元。每月基础 2,000 积分，活动期间每月额外赠送 2,000 积分，共 4,000 积分。', image: art('05-linghang-member'),
    blurb: '套餐价格已确定；购买与自动续费暂未开放。', features: ['活动赠送每月发放，并非只赠首月', '积分当期有效、不结转', '学习助手、规划、诊断与练习按实际模型用量扣积分'],
    back: [art('04-ai-helper'), art('08-deep-review'), art('12-diagnose-report', 'png'), art('14-weekly-review')] },
  { id: 'supply', name: '补给包', category: '1,000 积分 / 包', price: '¥50 / 包', detail: '每包 50 元，补充 1,000 积分，自到账起一个月内有效。购买暂未开放。', image: art('06-supply-pack'),
    blurb: '需要时按需补充积分；积分购买暂未开放。', features: ['每包 1,000 积分', '有效期一个月，优先扣除临期积分', '不对应固定对话或调用次数'],
    back: [art('09-task-flags'), art('13-mistake-redo'), art('14-weekly-review')] },
] as const;

type Tier = typeof PRICING_POSTCARDS[number];

function PricingDetails({ initial, onClose }: { initial: number; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(initial);
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
  return createPortal(<dialog ref={dialogRef} className="spb-dialog" aria-label="StudyPilot AI 使用方式与账户" onCancel={onClose}>
    <header><div><span>STUDYPILOT · 学习补给</span><h2>学习方案与平台账户</h2></div><button type="button" onClick={onClose} aria-label="关闭计费说明">×</button></header>
    <div className="spb-detail-tabs" role="group" aria-label="查看计费档位">{PRICING_POSTCARDS.map((item, index) => <button type="button" key={item.id} aria-pressed={selected === index} onClick={() => setSelected(index)}>{item.name}</button>)}</div>
    <div className="spb-detail-heading"><h3>{tier.name}</h3><strong>{tier.price}</strong></div>
    <p>{tier.detail}</p><p>{tier.blurb}</p><ul>{tier.features.map((item) => <li key={item}>{item}</li>)}</ul>
    <p className="spb-key-rule">平台支持能力、供应商、模型和价目均以账户目录为准。目录没有模型或支付渠道未配置时，相关功能不会开放。</p>
    {selected > 0 && <PlatformBillingCard />}
    <p className="spb-detail-note">积分与使用明细以服务端记录为准；付费套餐暂未开放购买。</p>
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
            <div className="spb-front-copy"><span>STUDYPILOT</span><h4>{tier.name}</h4><strong>{tier.price}</strong><p>{index === 1 ? '每月积分\n按用量结算' : index === 2 ? '补充额度\n继续学习' : '从今天出发\n每一步都算数'}</p><span className="spb-front-seal">{index === 1 ? '活动每月 4,000 积分' : index === 2 ? '1,000 积分 · 一个月' : '每月 500 积分'}</span></div>
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
    <div ref={railRef} className="spb-tier-rail" tabIndex={0} role="group" aria-label={`${PRICING_POSTCARDS.length} 项学习方案，按住鼠标左键左右拖动，或使用左右方向键`} onScroll={(event) => {
      const rail = event.currentTarget;
      const step = (rail.firstElementChild?.getBoundingClientRect().width ?? rail.clientWidth) + 48;
      setActive(Math.max(0, Math.min(PRICING_POSTCARDS.length - 1, Math.round(rail.scrollLeft / step))));
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
    <p className="spb-drag-hint"><span>按住左键左右拖动 · 触屏可滑动</span><span aria-live="polite">{active + 1} / {PRICING_POSTCARDS.length}</span></p>
    <div className="spb-bottom-bar"><p>StudyPilot：基础免费 · 平台积分按用量结算 · 按需补充。<span>平台模型与支付渠道以账户实际配置为准。</span></p><button type="button" onClick={() => setDetails(1)}>了解计费 <span aria-hidden="true">↗</span></button></div>
    <a className="spb-back-to-learning" href="#overview-content">回到学习总览 ↑</a>
    {details !== null && <PricingDetails initial={details} onClose={() => setDetails(null)} />}
  </div>;
}
