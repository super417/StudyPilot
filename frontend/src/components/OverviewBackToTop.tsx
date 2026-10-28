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
      <span className="overview-back-to-top__icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}

export default OverviewBackToTop;
