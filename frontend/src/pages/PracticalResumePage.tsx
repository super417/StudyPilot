import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, CloudOff, Loader2 } from 'lucide-react';

import AnimatedCloseButton from '@/components/AnimatedCloseButton';
import { useResumeDocumentSync } from '@/hooks/useResumeDocumentSync';

/** 本地内置的简历编辑器入口（vite 把根路径映射到 public/resume-site）。 */
const RESUME_APP_URL = '/zh';

interface PracticalResumePageProps {
  onBack: () => void;
}

function formatSyncedAt(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function PracticalResumePage({ onBack }: PracticalResumePageProps) {
  const { ready, status, lastSyncedAt } = useResumeDocumentSync();
  // 只在「这次进入」隐藏：不落 localStorage，离开页面再进来提示会重新出现。
  const [noticeVisible, setNoticeVisible] = useState(true);
  const syncedAt = formatSyncedAt(lastSyncedAt);

  return (
    <section className="flex h-dvh w-full flex-col overflow-hidden bg-white">
      <div className="flex items-center border-b border-slate-200 px-5 py-4 sm:px-7">
        <div className="flex items-center gap-4">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm text-brandDark/70 hover:text-brandDark">
            <ArrowLeft size={16} aria-hidden="true" /> 返回选择
          </button>
          <h1 className="text-lg font-semibold text-brandDark">StudyPilot 简历管理</h1>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {noticeVisible ? (
          <motion.div
            key="resume-notice"
            initial={false}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden border-b border-slate-200 bg-slate-50"
          >
            <div className="flex items-center gap-3 px-5 py-2 sm:px-7">
              <p className="min-w-0 flex-1 text-xs leading-5 text-slate-600">
                简历保存在你的 StudyPilot 账号里，换设备登录后自动恢复；导出 PDF 后仍建议留一份本地备份。
              </p>
              {status === 'syncing' ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-brandDark/70">
                  <Loader2 size={12} className="animate-spin" aria-hidden="true" /> 同步中…
                </span>
              ) : null}
              {status === 'synced' ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-emerald-600">
                  <CheckCircle2 size={12} aria-hidden="true" /> 已同步{syncedAt ? ` · ${syncedAt}` : ''}
                </span>
              ) : null}
              {status === 'offline' ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-amber-600">
                  <CloudOff size={12} aria-hidden="true" /> 暂未连上服务器，先保存在本机
                </span>
              ) : null}
              <AnimatedCloseButton onClose={() => setNoticeVisible(false)} label="关闭简历保存说明" />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {ready ? (
        <iframe src={RESUME_APP_URL} title="StudyPilot 简历编辑器" className="min-h-0 w-full flex-1 border-0" />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-50 text-sm text-slate-500">
          正在载入简历…
        </div>
      )}
    </section>
  );
}

export default PracticalResumePage;
