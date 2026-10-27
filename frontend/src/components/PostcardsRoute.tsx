import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Alignment, Fit, Layout, RuntimeLoader, useRive, useViewModelInstanceNumber } from '@rive-app/react-canvas';

RuntimeLoader.setWasmUrl('/postcards/animation/rive.wasm');

const subscribe = (callback: () => void) => {
  const query = window.matchMedia('(max-width: 767px)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
};
const getMobile = () => window.matchMedia('(max-width: 767px)').matches;

function RouteCanvas({ mobile }: { mobile: boolean }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const name = mobile ? 'built_mobile' : 'built';
  const { rive, RiveComponent } = useRive({
    src: '/postcards/animation/mailerbot-heros.riv',
    artboard: name,
    stateMachine: name,
    autoBind: true,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
    isTouchScrollEnabled: true,
  });
  const { setValue } = useViewModelInstanceNumber('scroll', rive?.viewModelInstance);

  useEffect(() => {
    if (!rive || !setValue) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const element = frameRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (!rect.height) return;
      const top = mobile ? element.closest('section')?.getBoundingClientRect().top ?? rect.top : rect.top;
      const lead = mobile ? window.innerHeight * .8 : window.innerHeight;
      setValue(Math.max(0, Math.min(100, (lead - top) / (rect.height * 2) * 100)));
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [mobile, rive, setValue]);

  return <div ref={frameRef} className="spp-route-original"><RiveComponent aria-hidden="true" tabIndex={-1} /></div>;
}

function PostcardsRoute() {
  const mobile = useSyncExternalStore(subscribe, getMobile, () => false);
  return <RouteCanvas mobile={mobile} key={mobile ? 'mobile' : 'desktop'} />;
}

export default PostcardsRoute;
