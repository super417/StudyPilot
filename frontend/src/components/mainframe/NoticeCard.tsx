/**
 * 站内信卡片 —— 原「Reach us: hello@mainframe.co」那个 pill 的落点。
 *
 * 为什么不做真实发信：演示场景里任何一次外呼失败都会当场翻车，而"联系我们"这个动作
 * 在评审语境下也没有真实收件方。改成站内信后，动作变成**应用内可见的反馈**，
 * 点了一定有反应，且展示的是真实的复盘数据。
 *
 * 卡片弹出的同时会往助手窗插一条同内容消息（在 `MainframePage` 里触发），
 * 这样评委回到主应用还能在聊天记录里再看到一次。
 */
import { motion } from 'framer-motion';
import { ArrowRight, Bell, X } from 'lucide-react';
import type { DemoSnapshot } from '@/lib/mainframeDemo';
import { formatHours } from '@/lib/mainframeDemo';

export interface NoticeCardProps {
  snapshot: DemoSnapshot;
  onViewWeekly: () => void;
  onClose: () => void;
}

function NoticeCard({ snapshot, onViewWeekly, onClose }: NoticeCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-md"
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="w-full max-w-sm overflow-hidden rounded-3xl border border-white/12 bg-[#0B0F0D]"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
          <div className="flex items-center gap-2 text-white/60">
            <Bell className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-[11px] tracking-[0.16em]">站内信</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭站内信"
            className="rounded-full p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-5 py-5">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand"
              aria-hidden="true"
            >
              <Bell className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[16px] font-medium leading-snug text-white">
                本周复盘已生成
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">
                完成率 {snapshot.completionRate}% · 学习 {formatHours(snapshot.totalMinutes)}{' '}
                小时 · 连续 {snapshot.streakDays} 天
              </p>
              {snapshot.phaseTotal > 0 ? (
                <p className="mt-1 text-[12px] text-white/35">
                  阶段进度 {snapshot.phaseCompleted}/{snapshot.phaseTotal}
                </p>
              ) : null}
              <p className="mt-3 text-[11.5px] text-white/30">刚刚 · 学习助手</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3.5 py-1.5 text-[12.5px] text-white/55 transition-colors hover:text-white"
          >
            知道了
          </button>
          <button
            type="button"
            onClick={onViewWeekly}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[12.5px] font-medium text-black transition-opacity hover:opacity-80"
          >
            查看详情
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default NoticeCard;
