import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import './StudyPilotJourney.css';
import { scrollToLearningOverview } from '@/lib/overviewNavigation';

const assetRoot = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/';
const images = {
  facilityA: assetRoot + 'hf_20260922_195936_f0de7dcd-eb12-4db3-8964-5403dc6472f6.png',
  facilityB: assetRoot + 'hf_20260922_200129_317be2c2-73fc-461c-9980-139305628bc2.png',
  quadruped: assetRoot + 'hf_20260922_200245_6438a01f-b0be-4ca6-84b5-05c2335db1ce.png',
  drone: assetRoot + 'hf_20260922_200248_94585d80-5f12-4dd6-88f2-c51530810ddc.png',
  humanoid: assetRoot + 'hf_20260922_200428_597e31e2-e842-4d6d-99fb-9759055df68d.png',
  dock: assetRoot + 'hf_20260922_200456_60a2f7ce-7fc6-47dd-acf2-33c7cb3d10f4.png',
  rover: assetRoot + 'hf_20260922_200242_24e51f89-a6a2-4a3d-817c-ea972debc06c.png',
  sensors: assetRoot + 'hf_20260922_200256_95687c15-d5b4-44e9-b347-85c779cd7e0f.png',
  cameras: assetRoot + 'hf_20260922_200300_a342388e-ee99-4f7a-aeca-c4b19ee78106.png',
};

// Keep the reference artwork where StudyPilot has no truthful visual equivalent.
// Learning labels illustrate a flow, rather than reporting live learner events.
const alerts = [
  { x: '53.6%', y: '6.7%', text: '学习目标待明确' },
  { x: '65.1%', y: '28.0%', text: '阶段路线待规划' },
  { x: '49.7%', y: '42.9%', text: '今日任务待安排' },
  { x: '27.5%', y: '51.4%', text: '练习记录待整理' },
  { x: '80.9%', y: '52.4%', text: '错题需要回看' },
  { x: '52.4%', y: '63.8%', text: '学习进展待汇总' },
  { x: '20.6%', y: '66.4%', text: '复盘反馈待记录' },
];
const resolved = [
  { x: '55.6%', y: '10.2%', text: '明确学习目标 —\n从目标开始规划' },
  { x: '66.2%', y: '27.9%', text: '展开阶段路线\n看见下一步安排' },
  { x: '49.4%', y: '41.7%', text: '把路线落实到今日任务' },
  { x: '78.5%', y: '50.6%', text: '练习与错题\n留在同一路线上' },
  { x: '51.7%', y: '60.8%', text: '回看学习记录\n查看阶段进展' },
  { x: '24.1%', y: '63.3%', text: '依据记录提出调整\n确认后再改变计划' },
];
const modules = ['学习目标', '阶段路线', '每日任务', '练习记录', '错题回顾', '数据统计', '学习反馈'];
const aboutWords = [
  '从', '目标', '开始，', 'StudyPilot', ' 把', '学习', '路线、', '当天', '任务、',
  '练习', '记录', '与', '复盘', '反馈', '放在', '同一条', '路线', '上。',
  '每一步', '都能', '回到', '原来的', '学习', '目标，', '方便', '看见', '今天',
  '做了', '什么、', '下一步', '要做', '什么。',
];
const devices = [
  { image: images.dock, alt: 'Autonomous drone-in-a-box docking station', l: '13%', t: '79%', w: '18%', z: 79 },
  { image: images.drone, alt: 'Autonomous inspection drone', l: '20%', t: '57%', w: '15%', z: 57 },
  { image: images.humanoid, alt: 'Humanoid field robot', l: '33%', t: '42%', w: '16%', z: 42 },
  { image: images.rover, alt: 'Rugged autonomous ground rover', l: '50%', t: '36%', w: '15%', z: 36 },
  { image: images.quadruped, alt: 'Quadruped inspection robot', l: '67%', t: '42%', w: '15%', z: 42 },
  { image: images.sensors, alt: 'Industrial IoT sensor modules', l: '80%', t: '57%', w: '14%', z: 57 },
  { image: images.cameras, alt: 'CCTV and access-control camera cluster', l: '87%', t: '79%', w: '15%', z: 79 },
];
// Four original layer concepts, independent of the three articles.
const layers = ['Memory\nLayer', 'Multimodal\nIntelligence\nProcessing', 'Agentic Action\nOrchestration', 'Reinforcement\nLearning From\nHuman Feedback'];
const articles = [
  { pill: '学习记录', title: '从零散信息，\n到清晰的学习方向', detail: '目标、路线和练习放在同一处。先看见已有记录，再看见今天可以做什么。每一条记录都可以回看，为下一步提供依据。' },
  { pill: '行动安排', title: '有了方向，\n就从今天的任务开始', detail: '阶段路线与今日任务相连；练习和错题回顾跟随学习过程继续积累。需要调整时，先看建议与变更，再由学习者确认。' },
  { pill: '回顾反馈', title: '每一次回看，\n都帮助决定下一步', detail: '练习记录、错题和阶段进展可以回看。把自己的反馈留下来，沿着已有记录继续学习；调整仍由学习者确认。' },
];
const callouts = [
  { article: 0, text: '学习目标\n与已有记录', position: 'aside', x: '-2.6%', y: '30.1%' },
  { article: 1, text: '今日\n任务', position: 'aside', x: '-2.6%', y: '30.1%' },
  { article: 1, text: '练习\n记录', position: 'aside', x: '10.8%', y: '8.5%' },
  { article: 2, text: '错题\n回顾', position: 'aside', x: '-2.6%', y: '30.1%' },
  { article: 2, text: '学习\n反馈', position: 'aside', x: '10.8%', y: '8.5%' },
  { article: 2, text: '阶段路线\n与学习进展', position: 'atop', x: '36.6%', y: '-6%' },
];
const STEP_AT = [0.42, 0.60, 0.78];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const map = (value: number, start: number, end: number) => clamp((value - start) / (end - start));

function progress(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const span = rect.height - window.innerHeight;
  return span > 0 ? clamp(-rect.top / span) : Number(rect.top <= 0);
}

function Pill({ children, small = false }: { children: ReactNode; small?: boolean }) {
  return <span className={'spj-pill' + (small ? ' spj-pill-small' : '')}>
    <svg className="spj-pill-mark" viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="13" r="12" fill="#6C31D9" />
      <circle cx="13" cy="13" r="5.8" fill="none" stroke="#fff" strokeWidth="2.2" />
      <circle cx="13" cy="13" r="2.3" fill="#fff" />
    </svg>{children}
  </span>;
}

function Arrow() {
  return <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 9.5L9.5 2.5M4 2.5h5.5V8" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;
}

function StudyPilotJourney() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const intro = root.querySelector<HTMLElement>('.spj-intro')!;
    const about = root.querySelector<HTMLElement>('.spj-about')!;
    const engine = root.querySelector<HTMLElement>('.spj-engine')!;
    const engineStage = root.querySelector<HTMLElement>('.spj-engine-stage')!;
    const startBg = root.querySelector<HTMLElement>('.spj-intro-bg-start')!;
    const endBg = root.querySelector<HTMLElement>('.spj-intro-bg-end')!;
    const arc = root.querySelector<HTMLElement>('.spj-engine-arc')!;
    const stack = root.querySelector<HTMLElement>('.spj-engine-stack')!;
    const title = root.querySelector<HTMLElement>('.spj-engine-title')!;
    const card = root.querySelector<HTMLElement>('.spj-engine-card')!;
    const globe = root.querySelector<SVGElement>('.spj-globe')!;
    const rail = root.querySelector<HTMLElement>('.spj-progress-fill')!;
    const alertChips = [...root.querySelectorAll<HTMLElement>('.spj-note-alert')];
    const resolvedChips = [...root.querySelectorAll<HTMLElement>('.spj-note-ok')];
    const words = [...about.querySelectorAll<HTMLElement>('.spj-word')];
    const floats = [...root.querySelectorAll<HTMLElement>('.spj-float')];
    const plates = [...root.querySelectorAll<HTMLElement>('.spj-plate')];
    const copies = [...root.querySelectorAll<HTMLElement>('.spj-engine-copy article')];
    const dots = [...root.querySelectorAll<HTMLElement>('.spj-engine-dots i')];
    const labels = [...root.querySelectorAll<HTMLElement>('.spj-olab')];
    const loop = root.querySelector<HTMLElement>('.spj-loop')!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;

    const engineFrame = (p: number) => {
      const merge = map(p, 0.17, 0.29);
      arc.style.transform = 'scale(' + (1 - merge * 0.8) + ')';
      arc.style.opacity = String(1 - merge);
      title.style.opacity = card.classList.contains('is-in') ? String(1 - map(p, 0.17, 0.23)) : '';
      const travel = map(p, 0.27, 0.43);
      const dx = (1 - travel) * (0.50 - 0.78) * engineStage.clientWidth;
      const dy = (1 - travel) * (0.585 - 0.55) * engineStage.clientHeight;
      stack.style.opacity = String(map(p, 0.19, 0.29));
      stack.style.transform = 'translate(-50%, -50%) translate(' + dx + 'px, ' + dy + 'px) scale(' + (0.80 + travel * 0.20) + ')';
      globe.style.opacity = String(map(p, 0.34, 0.47));
      plates.forEach((plate, k) => {
        const amount = k === 0 ? 1 : map(p, STEP_AT[k - 1], STEP_AT[k - 1] + 0.10);
        plate.style.opacity = String(amount);
        plate.style.transform = 'translateY(' + (k === 0 ? 0 : -k * 5 + (1 - amount) * -58) + '%)';
      });
      const shown = p > 0.33;
      const current = p < 0.60 ? 0 : p < 0.78 ? 1 : 2;
      copies.forEach((copy, i) => copy.classList.toggle('is-current', shown && i === current));
      dots.forEach((dot, i) => dot.classList.toggle('is-current', shown && i === current));
      labels.forEach((label) => label.classList.toggle('is-current', shown && Number(label.dataset.article) === current && p > STEP_AT[current] + 0.04));
    };

    const update = () => {
      frame = 0;
      const rootRect = root.getBoundingClientRect();
      root.classList.toggle('spj-nav-active', rootRect.top <= 0 && rootRect.bottom > 74);
      const p = reduced.matches ? 1 : progress(intro);
      const swap = map(p, 0.38, 0.55);
      root.style.setProperty('--spj-scene-hue', String(226 + swap * 43));
      endBg.style.opacity = String(swap);
      startBg.style.opacity = String(1 - swap * 0.92);
      startBg.style.transform = endBg.style.transform = 'scale(' + (1 + p * 0.055) + ')';
      rail.style.height = p * 100 + '%';
      const inT = map(p, 0.10, 0.36);
      const outT = map(p, 0.40, 0.50);
      alertChips.forEach((chip, i) => chip.classList.toggle('is-visible', !reduced.matches && inT >= (i + 1) / alertChips.length * 0.92 && outT < 0.55));
      const okT = map(p, 0.52, 0.80);
      resolvedChips.forEach((chip, i) => chip.classList.toggle('is-visible', okT >= (i + 1) / resolvedChips.length * 0.9));

      const a = reduced.matches ? 1 : progress(about);
      const reveal = map(a, 0.06, 0.78);
      words.forEach((word, i) => word.classList.toggle('is-on', (i + 1) / words.length <= reveal));
      floats.forEach((item, i) => {
        if (a > 0.10 + i * 0.09) item.classList.add('is-visible');
        item.style.marginTop = -26 * a * (i % 2 ? 1 : -1) + 'px';
      });
      if (reduced.matches) {
        card.classList.add('is-in');
        loop.querySelectorAll('.spj-word').forEach((word) => word.classList.add('is-on'));
      }
      engineFrame(reduced.matches ? 0 : progress(engine));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const cardObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        card.classList.add('is-in');
        cardObserver.disconnect();
        schedule();
      }
    }, { threshold: 0.22 });
    const loopObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loop.querySelectorAll('.spj-word').forEach((word) => word.classList.add('is-on'));
        loopObserver.disconnect();
      }
    }, { threshold: 0.4 });
    cardObserver.observe(card);
    loopObserver.observe(loop);
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    reduced.addEventListener('change', schedule);
    return () => {
      cardObserver.disconnect();
      loopObserver.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      reduced.removeEventListener('change', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const scrollTo = (id: string) => {
    if (id === 'overview-content') return scrollToLearningOverview();
    document.getElementById(id)?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    block: 'start',
    });
  };

  return (
    <div ref={rootRef} id="study-journey" className="spj-root">
      <nav className="spj-nav" aria-label="学习流程导航">
        <a className="spj-logo" href="#study-journey" aria-label="StudyPilot 学习流程">StudyPilot<span aria-hidden="true">✳</span></a>
        <button className="spj-beta" type="button" onClick={() => scrollTo('overview-content')}>进入我的总览</button>
      </nav>
      <section className="spj-intro" aria-label="StudyPilot 学习流程示意">
        <div className="spj-intro-stage">
          <div className="spj-intro-bg-start" role="img" aria-label="Isometric render of an industrial facility with one equipment rack glowing red" style={{ backgroundImage: 'url(' + images.facilityA + ')' }} />
          <div className="spj-intro-bg-end" aria-hidden="true" style={{ backgroundImage: 'url(' + images.facilityB + ')' }} />
          <div className="spj-intro-veil" />
          <div className="spj-chip-field" aria-hidden="true">
            {alerts.map((note) => <span className="spj-note spj-note-alert" style={{ '--x': note.x, '--y': note.y } as CSSProperties} key={note.text}><i />{note.text}</span>)}
            {resolved.map((note) => <span className="spj-note spj-note-ok" style={{ '--x': note.x, '--y': note.y } as CSSProperties} key={note.text}>
              <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#fff" /><path d="M5.8 10.3l2.7 2.7 5.7-5.9" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>{note.text}
            </span>)}
          </div>
          <div className="spj-intro-copy">
            <Pill>从目标到每一步 · 学习流程示意</Pill>
            <h2>
              <span className="spj-title-lead">让学习的每一步</span>
              <span className="spj-title-verse"><span>都有<em>来处</em><span className="spj-title-punctuation">，</span></span><span>也有<em>去处</em><span className="spj-title-punctuation">。</span></span></span>
            </h2>
          </div>
          <div className="spj-intro-actions">
            <button className="spj-play" type="button" onClick={() => scrollTo('study-loop')} aria-label="查看学习循环"><svg viewBox="0 0 17 17" aria-hidden="true"><path d="M0 0l12 7-12 7z" fill="#fff" /></svg></button>
            <button className="spj-glass-card" type="button" onClick={() => scrollTo('overview-content')}>
              <span className="spj-glass-mark"><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#5B12E0" fillRule="evenodd" d="M18.4 3h11.2a7 7 0 0 1 4.95 2.05l8.4 8.4A7 7 0 0 1 45 18.4v11.2a7 7 0 0 1-2.05 4.95l-8.4 8.4A7 7 0 0 1 29.6 45H18.4a7 7 0 0 1-4.95-2.05l-8.4-8.4A7 7 0 0 1 3 29.6V18.4a7 7 0 0 1 2.05-4.95l8.4-8.4A7 7 0 0 1 18.4 3Zm3.1 14.2h5a4.6 4.6 0 0 1 3.25 1.35l2.7 2.7A4.6 4.6 0 0 1 33.8 24.5a4.6 4.6 0 0 1-1.35 3.25l-2.7 2.7a4.6 4.6 0 0 1-3.25 1.35h-5a4.6 4.6 0 0 1-3.25-1.35l-2.7-2.7A4.6 4.6 0 0 1 14.2 24.5a4.6 4.6 0 0 1 1.35-3.25l2.7-2.7a4.6 4.6 0 0 1 3.25-1.35Z" /></svg></span>
              <span><strong>进入我的总览 <Arrow /></strong><small>查看目标、任务<br />与学习进展。</small></span>
            </button>
          </div>
          <div className="spj-progress-rail" aria-hidden="true"><span className="spj-progress-track"><span className="spj-progress-fill" /></span><i /><i /><i /></div>
        </div>
      </section>

      <section className="spj-strip" aria-label="StudyPilot 学习环节">
        <div className="spj-strip-inner">
          <span className="spj-strip-label">每一步，都在<br />同一条路线上</span>
          <div className="spj-strip-marquee"><div className="spj-strip-track">
            {[0, 1].map((copy) => <div className="spj-strip-row" aria-hidden={copy === 1 ? true : undefined} key={copy}>{modules.map((label, i) => <span className={'spj-strip-item brand' + i} key={label}>{label}</span>)}</div>)}
          </div></div>
        </div>
        <div className="spj-strip-rule" />
      </section>

      <section className="spj-about" aria-label="关于 StudyPilot 的学习方式">
        <div className="spj-about-stage"><div className="spj-about-inner">
          <div><Pill small>关于 StudyPilot</Pill></div>
          <div className="spj-about-copy">
            <p aria-label={aboutWords.join('')}>{aboutWords.map((word, i) => <span className="spj-word" aria-hidden="true" key={i}>{word}</span>)}</p>
            {[{ src: images.quadruped, alt: 'Quadruped inspection robot' }, { src: images.drone, alt: 'Autonomous inspection drone' }, { src: images.humanoid, alt: 'Humanoid field robot' }].map((image, i) => <figure className={'spj-float f' + (i + 1)} key={image.src}><img src={image.src} alt={image.alt} loading="eager" /></figure>)}
          </div>
        </div></div>
      </section>

      <section className="spj-loop" id="study-loop" aria-label="学习循环">
        <div className="spj-ring-wrap" aria-hidden="true">
          <div className="spj-ring" />
          {[0, 128, 243].map((angle) => <div className="spj-orb" style={{ '--a': angle + 'deg' } as CSSProperties} key={angle}><i /></div>)}
        </div>
        <div className="spj-loop-copy"><Pill small>学习循环</Pill><h2><span className="spj-word">观察、</span><span className="spj-word">练习、</span><span className="spj-word">反馈</span><br /><span className="spj-word">再找到</span><span className="spj-word">下一步</span></h2></div>
      </section>

      <section className="spj-engine" id="study-engine" aria-label="StudyPilot 学习结构">
        <div className="spj-engine-stage">
          <div className="spj-engine-card">
            <h2 className="spj-engine-title">StudyPilot 学习结构</h2>
            <div className="spj-engine-arc" aria-label="七种设备的参考场景">
              {devices.map((device, i) => <div className={'spj-engine-node' + (i === 1 ? ' flying' : '')} style={{ '--l': device.l, '--t': device.t, '--w': device.w, '--z': device.z, '--d': (i * 0.08).toFixed(2) + 's' } as CSSProperties} key={device.image}>
                <div className="spj-node-lift"><div className="spj-node-ped"><span className="spj-node-side" /><span className="spj-node-top" /><img className="spj-device" src={device.image} alt={device.alt} loading="eager" /></div></div>
              </div>)}
            </div>
            <div className="spj-engine-dots" aria-hidden="true"><i /><i /><i /></div>
            <div className="spj-engine-copy">
              {articles.map((article) => <article key={article.pill}><Pill small>{article.pill}</Pill><h3>{article.title}</h3><p>{article.detail}</p></article>)}
            </div>
          </div>
          <div className="spj-stack-wrap" aria-hidden="true"><div className="spj-engine-stack">
            {layers.map((label) => <div className="spj-plate" key={label}><span className="spj-plate-side" /><span className="spj-plate-top"><em>{label}</em></span></div>)}
            <svg className="spj-globe" viewBox="0 0 400 400">
              <circle className="spj-globe-rim" cx="200" cy="200" r="199" />
              {[199, 140, 68].map((radius) => <ellipse className="spj-globe-meridian" key={radius} cx="200" cy="200" rx={radius} ry="199" />)}
              {[[12, 136], [60, 59], [152, 7], [268, 13]].map(([x, y]) => <g className="spj-globe-pip" transform={'translate(' + x + ',' + y + ')'} key={x}><circle r="11" fill="rgba(124,77,237,.13)" /><circle r="2.2" fill="#6C31D9" /></g>)}
            </svg>
            <div className="spj-orbit-labels">{callouts.map((label, i) => <span className={'spj-olab ' + label.position} data-article={label.article} style={{ '--x': label.x, '--y': label.y } as CSSProperties} key={i}>{label.text}</span>)}</div>
          </div></div>
        </div>
      </section>

      <div className="spj-outro"><span aria-hidden="true">✳</span><p>路径看得见，今天就有下一步。</p><button className="spj-beta" type="button" onClick={() => scrollTo('overview-content')}>进入我的总览 <span aria-hidden="true">↓</span></button></div>
    </div>
  );
}

export default StudyPilotJourney;
