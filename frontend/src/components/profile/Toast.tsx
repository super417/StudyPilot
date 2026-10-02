import { AnimatePresence, motion } from 'framer-motion';

/** toast 展示容器（固定底部居中）。 */
export function ToastHost({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message ? (
        <motion.div
          className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
        >
          <div
            role="status"
            className="rounded-full bg-brandDark px-5 py-2.5 text-sm font-medium text-white shadow-card"
          >
            {message}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
