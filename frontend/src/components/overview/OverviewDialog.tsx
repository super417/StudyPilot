import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './OverviewDialog.css';

export default function OverviewDialog({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<dialog ref={ref} className={`spp-dialog ${className}`} aria-label={title} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="spp-dialog-heading"><h2>{title}</h2><button type="button" aria-label="关闭弹窗" onClick={onClose}>×</button></div>
    {children}
  </dialog>, document.body);
}
