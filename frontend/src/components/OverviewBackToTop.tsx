import { useEffect, useState } from 'react';
import './OverviewBackToTop.css';

function OverviewBackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let previousY = Math.max(0, window.scrollY);
    const previousPositions = new WeakMap<HTMLElement, number>();
    document.querySelectorAll<HTMLElement>('[data-back-to-top-scroll]').forEach((element) => {
      previousPositions.set(element, element.scrollTop);
    });
    const update = () => {
      const currentY = Math.max(0, window.scrollY);
      if (currentY <= 24) setVisible(false);
      else if (currentY !== previousY) setVisible(currentY < previousY);
      previousY = currentY;
    };
    const updateSection = (event: Event) => {
      const element = event.target;
      if (!(element instanceof HTMLElement) || !element.hasAttribute('data-back-to-top-scroll')) return;
      const currentY = Math.max(0, element.scrollTop);
      const previous = previousPositions.get(element) ?? 0;
      if (currentY <= 24) setVisible(false);
      else if (currentY !== previous) setVisible(currentY < previous);
      previousPositions.set(element, currentY);
    };
    window.addEventListener('scroll', update, { passive: true });
    document.addEventListener('scroll', updateSection, { passive: true, capture: true });
    return () => {
      window.removeEventListener('scroll', update);
      document.removeEventListener('scroll', updateSection, true);
    };
  }, []);

  return (
    <button
      type="button"
      className="overview-back-to-top"
      hidden={!visible}
      aria-label="返回顶部"
      onClick={() => {
        const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
        window.scrollTo({ top: 0, behavior });
        document.querySelectorAll<HTMLElement>('[data-back-to-top-scroll]').forEach((element) => {
          element.scrollTo({ top: 0, behavior });
        });
      }}
    >
      <svg className="overview-back-to-top__icon" viewBox="0 0 384 512" aria-hidden="true">
        <path d="M214.6 41.4c-12.5-12.5-32.8-12.5-45.3 0l-160 160c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L160 141.2V448c0 17.7 14.3 32 32 32s32-14.3 32-32V141.2L329.4 246.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-160-160z" />
      </svg>
    </button>
  );
}

export default OverviewBackToTop;
