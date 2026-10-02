import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * 轻量居中弹窗（用于「编辑资料」等表单，避免撑长页面）。
 * - 遮罩点击关闭、Esc 关闭、关闭按钮。
 * - 打开时锁定 body 滚动，焦点可用。
 */
function Modal({ open, title, onClose, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-brandDark/30 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            className="relative z-10 w-full max-w-md rounded-[28px] bg-card p-6 shadow-[0_24px_64px_rgba(6,78,59,0.18)]"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-brandDark">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition hover:bg-bg hover:text-brandDark"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="mt-4">{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default Modal;
