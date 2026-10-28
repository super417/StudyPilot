import { useEffect, useState } from 'react';
import './OverviewBackToTop.css';

function OverviewBackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let previousY = Math.max(0, window.scrollY);
    const update = () => {
      const currentY = Math.max(0, window.scrollY);
      if (currentY <= 24) setVisible(false);
      else if (currentY !== previousY) setVisible(currentY < previousY);
      previousY = currentY;
    };
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  return (
    <button
      type="button"
      className="overview-back-to-top"
      hidden={!visible}
      aria-label="返回顶部"
      onClick={() => window.scrollTo({
        top: 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      })}
    >
      <svg className="overview-back-to-top__icon" viewBox="0 0 384 512" aria-hidden="true">
        <path d="M214.6 41.4c-12.5-12.5-32.8-12.5-45.3 0l-160 160c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L160 141.2V448c0 17.7 14.3 32 32 32s32-14.3 32-32V141.2L329.4 246.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-160-160z" />
      </svg>
    </button>
  );
}

export default OverviewBackToTop;
