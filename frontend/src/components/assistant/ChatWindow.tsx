import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarRange, Maximize2, MessageSquarePlus, X } from 'lucide-react';

import { selectActiveMessages, useAssistantStore } from '@/store';
import type { AssistantContext } from '@/store';
import { usePlanSessionStore } from '@/store/planSessionStore';
import GoalSubmitForm from '@/components/planner/GoalSubmitForm';
import AssistantInput from '@/components/chat/AssistantInput';
import { useAssistantChat } from '@/hooks/useAssistantChat';
import { openMainframePage } from '@/lib/mainframeRoute';

const CONTEXT_LABEL: Record<AssistantContext['type'], string> = {
  mistake: '错题',
  plan: '学习规划',
  free: '自由提问',
};

/**
 * 悬浮小窗。发送链路与全屏聊天面板共用 `useAssistantChat`，
 * 输入框共用 `AssistantInput` —— 两处只有外壳不同，行为必须完全一致。
 */
function ChatWindow() {
  const open = useAssistantStore((s) => s.open);
  const context = useAssistantStore((s) => s.context);
  const messages = useAssistantStore(selectActiveMessages);
  const setContext = useAssistantStore((s) => s.setContext);
  const clearContext = useAssistantStore((s) => s.clearContext);
  const closeAssistant = useAssistantStore((s) => s.closeAssistant);
  const startConversation = useAssistantStore((s) => s.startConversation);
  const lastPlanId = usePlanSessionStore((s) => s.lastPlanId);
  const { send, stop, streaming, interrupted } = useAssistantChat(open);

  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const showPlanForm = context?.type === 'plan';

  /** 窗口关掉就掐断在途请求，别让它在后台继续烧 token */
  useEffect(() => {
    if (!open && streaming) stop();
  }, [open, streaming, stop]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    send(text);
  };

  const handleNewChat = () => {
    if (streaming) stop();
    setInput('');
    void startConversation();
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="assistant-window"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
          style={{ transformOrigin: 'bottom right', zIndex: 9998 }}
          className="fixed bottom-24 right-4 flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-3xl bg-card shadow-[0_20px_60px_rgba(6,78,59,0.18)] sm:right-6"
        >
          <header className="flex items-center justify-between gap-2 bg-brandDark px-4 py-3 text-white">
            <span className="text-sm font-semibold">考研学习助手</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="开启新聊天"
                title="开启新聊天"
                onClick={handleNewChat}
                className="rounded-full p-1 transition-colors hover:bg-white/15"
              >
                <MessageSquarePlus className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={showPlanForm ? '收起考研目标表单' : '提交考研学习目标'}
                title={showPlanForm ? '收起目标表单（聊天继续）' : '提交考研学习目标'}
                aria-pressed={showPlanForm}
                onClick={() => {
                  if (showPlanForm) {
                    clearContext();
                    return;
                  }
                  setContext({ type: 'plan', hint: '制定或调整考研复习规划' });
                }}
                className={`rounded-full p-1 transition-colors hover:bg-white/15 ${
                  showPlanForm ? 'bg-white/20' : ''
                }`}
              >
                <CalendarRange className="h-4 w-4" />
              </button>
              <motion.button
                type="button"
                aria-label="展开全屏"
                title="展开全屏"
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.82, rotate: -8 }}
                transition={{ type: 'spring', stiffness: 520, damping: 18 }}
                onClick={() => {
                  closeAssistant();
                  // 进演示首屏，不自动弹聊天框 —— 首屏先给大图，聊天要点药丸才出
                  openMainframePage();
                }}
                className="rounded-full p-1 transition-colors hover:bg-white/15"
              >
                <motion.span
                  className="block"
                  initial={false}
                  whileTap={{ scale: 1.25 }}
                >
                  <Maximize2 className="h-4 w-4" />
                </motion.span>
              </motion.button>
              <button
                type="button"
                aria-label="关闭学习助手"
                onClick={closeAssistant}
                className="rounded-full p-1 transition-colors hover:bg-white/15"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          {context ? (
            <div className="bg-brandFaint px-4 py-2 text-xs text-brandDark">
              正在讨论：{CONTEXT_LABEL[context.type]}
              {context.hint ? (
                <span className="text-brandDark/70">（{context.hint}）</span>
              ) : null}
            </div>
          ) : null}

          {showPlanForm ? <GoalSubmitForm onDismiss={clearContext} /> : null}

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <p className="pt-6 text-center text-sm text-gray-400">
                考研提问走真实 SSE；点日历可提交学习目标
                <br />
                <span className="mt-2 inline-block text-xs">
                  支持领域拦截 · 知识库摘录 · 规划 Agent
                </span>
              </p>
            ) : null}
            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
                >
                  <div
                    className={
                      m.role === 'user'
                        ? 'max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand px-3 py-2 text-sm text-white'
                        : 'max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-brandFaint px-3 py-2 text-sm text-brandDark'
                    }
                  >
                    {m.content}
                    {m.streaming ? <span className="ml-0.5 animate-pulse">▋</span> : null}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {interrupted ? (
              <p className="text-center text-xs text-dangerText">响应未完成（已停止）</p>
            ) : null}
          </div>

          <div className="border-t border-brandFaint px-3 py-3">
            <AssistantInput
              value={input}
              onChange={setInput}
              onSend={handleSend}
              onStop={stop}
              streaming={streaming}
              placeholder={lastPlanId ? '描述如何调整规划…' : '考研相关问题或调整规划说明…'}
            />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default ChatWindow;
