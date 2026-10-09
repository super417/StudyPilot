import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarRange, Maximize2, MessageSquarePlus, X } from 'lucide-react';

import { selectActiveMessages, useAssistantStore } from '@/store';
import type { AssistantContext } from '@/store';
import { usePlanSessionStore } from '@/store/planSessionStore';
import GoalSubmitForm from '@/components/planner/GoalSubmitForm';
import AssistantInput from '@/components/chat/AssistantInput';
import AssistantMessage from '@/components/chat/AssistantMessage';
import UserMessage from '@/components/chat/UserMessage';
import { useAssistantChat } from '@/hooks/useAssistantChat';
import { useStickToBottom } from '@/hooks/useStickToBottom';
import { isPauseRequest } from '@/lib/pauseRequest';
import { isMainframeChatExpand, openMainframeFromWidget } from '@/lib/mainframeRoute';

const CONTEXT_LABEL: Record<AssistantContext['type'], string> = {
  mistake: '错题',
  plan: '学习规划',
  free: '自由提问',
};

const MIN_W = 300;
const MIN_H = 360;
const PAD_X = 16;
const PAD_TOP = 8;
const PAD_BOTTOM = 96;

type ChatBox = { left: number; top: number; width: number; height: number };
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

function isDesktop() {
  return window.innerWidth >= 640;
}

function clampBox(box: ChatBox): ChatBox {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxW = Math.max(160, vw - PAD_X * 2);
  const maxH = Math.max(200, vh - PAD_TOP - PAD_BOTTOM);
  if (!isDesktop()) {
    const width = Math.min(maxW, vw - PAD_X * 2);
    const height = Math.min(maxH, Math.round(vh * 0.7));
    return {
      width,
      height,
      left: PAD_X,
      top: Math.max(PAD_TOP, vh - PAD_BOTTOM - height),
    };
  }
  const width = Math.min(maxW, Math.max(Math.min(MIN_W, maxW), box.width));
  const height = Math.min(maxH, Math.max(Math.min(MIN_H, maxH), box.height));
  const left = Math.min(vw - PAD_X - width, Math.max(PAD_X, box.left));
  const top = Math.min(vh - PAD_BOTTOM - height, Math.max(PAD_TOP, box.top));
  return { left, top, width, height };
}

function defaultBox(): ChatBox {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(384, Math.max(160, vw - PAD_X * 2));
  const height = Math.min(Math.round(vh * 0.7), Math.max(200, vh - PAD_TOP - PAD_BOTTOM));
  return clampBox({
    width,
    height,
    left: vw - PAD_X - width,
    top: vh - PAD_BOTTOM - height,
  });
}

const HANDLES: { dir: ResizeDir; className: string }[] = [
  { dir: 'n', className: 'left-3 right-3 top-0 h-1.5 cursor-n-resize' },
  { dir: 's', className: 'left-3 right-3 bottom-0 h-1.5 cursor-s-resize' },
  { dir: 'e', className: 'top-3 bottom-3 right-0 w-1.5 cursor-e-resize' },
  { dir: 'w', className: 'top-3 bottom-3 left-0 w-1.5 cursor-w-resize' },
  { dir: 'ne', className: 'right-0 top-0 h-3 w-3 cursor-ne-resize' },
  { dir: 'nw', className: 'left-0 top-0 h-3 w-3 cursor-nw-resize' },
  { dir: 'se', className: 'right-0 bottom-0 h-4 w-4 cursor-se-resize' },
  { dir: 'sw', className: 'left-0 bottom-0 h-3 w-3 cursor-sw-resize' },
];

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
  const awaitingConfirm = usePlanSessionStore((s) => s.awaitingConfirm);
  const { send, resend, stop, pause, streaming, interrupted } = useAssistantChat(open);

  const input = useAssistantStore((s) => s.composerDraft);
  const setInput = useAssistantStore((s) => s.setComposerDraft);
  const [box, setBox] = useState<ChatBox>(() =>
    typeof window === 'undefined'
      ? { left: 16, top: 8, width: 384, height: 480 }
      : defaultBox(),
  );
  const dragRef = useRef<{
    dir: ResizeDir;
    x: number;
    y: number;
    box: ChatBox;
  } | null>(null);
  const showPlanForm = context?.type === 'plan';
  const contentKey = `${messages.length}:${messages[messages.length - 1]?.content.length ?? 0}:${open}`;
  const { listRef, onScroll, pinToBottom } = useStickToBottom(open, contentKey);

  useEffect(() => {
    if (!open && streaming && !isMainframeChatExpand()) stop();
  }, [open, streaming, stop]);

  useLayoutEffect(() => {
    if (!open) return;
    setBox((current) => clampBox(current));
  }, [open]);

  useEffect(() => {
    const onResize = () => setBox((current) => clampBox(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerMove = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    const next = { ...drag.box };
    if (drag.dir.includes('e')) next.width = drag.box.width + dx;
    if (drag.dir.includes('s')) next.height = drag.box.height + dy;
    if (drag.dir.includes('w')) {
      next.left = drag.box.left + dx;
      next.width = drag.box.width - dx;
    }
    if (drag.dir.includes('n')) {
      next.top = drag.box.top + dy;
      next.height = drag.box.height - dy;
    }
    setBox(clampBox(next));
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
  }, [onPointerMove]);

  const startDrag = (dir: ResizeDir) => (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { dir, x: event.clientX, y: event.clientY, box };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || (streaming && !isPauseRequest(text))) return;
    pinToBottom();
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
          style={{
            transformOrigin: 'bottom right',
            zIndex: 9998,
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
          }}
          className="fixed flex max-h-[100dvh] min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl bg-card shadow-[0_20px_60px_rgba(6,78,59,0.18)]"
        >
          {HANDLES.map((handle) => (
            <button
              key={handle.dir}
              type="button"
              aria-label={`调整窗口${handle.dir}`}
              onPointerDown={startDrag(handle.dir)}
              className={`absolute z-10 hidden touch-none border-0 bg-transparent p-0 sm:block ${handle.className}`}
            />
          ))}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-1.5 right-1.5 hidden h-2.5 w-2.5 rounded-br-md border-b-2 border-r-2 border-brand/45 sm:block"
          />

          <header className="flex shrink-0 items-center justify-between gap-2 bg-brandDark px-4 py-3 text-white">
            <span className="truncate text-sm font-semibold">考研学习助手</span>
            <div className="flex shrink-0 items-center gap-1">
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
                  openMainframeFromWidget();
                  closeAssistant();
                }}
                className="rounded-full p-1 transition-colors hover:bg-white/15"
              >
                <motion.span className="block" initial={false} whileTap={{ scale: 1.25 }}>
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
            <div className="shrink-0 bg-brandFaint px-4 py-2 text-xs text-brandDark">
              正在讨论：{CONTEXT_LABEL[context.type]}
              {context.hint ? (
                <span className="break-words text-brandDark/70">（{context.hint}）</span>
              ) : null}
            </div>
          ) : null}

          {showPlanForm ? (
            <div className="min-h-0 max-h-[42%] shrink-0 overflow-y-auto overflow-x-hidden">
              <GoalSubmitForm onDismiss={clearContext} />
            </div>
          ) : null}

          <div
            ref={listRef}
            onScroll={onScroll}
            className="min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto px-4 py-4"
          >
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
                  className={
                    m.role === 'user'
                      ? 'flex w-full min-w-0 justify-end'
                      : 'flex w-full min-w-0 justify-start'
                  }
                >
                  {m.role === 'user' ? (
                    <UserMessage
                      message={m}
                      bubbleClassName="whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand px-3 py-2 text-sm text-white"
                      onResend={resend}
                    />
                  ) : (
                    <AssistantMessage
                      message={m}
                      bubbleClassName="rounded-2xl rounded-bl-sm bg-brandFaint px-3 py-2 text-sm leading-relaxed text-brandDark"
                      onResend={resend}
                    />
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            {interrupted ? (
              <p className="text-center text-xs text-dangerText">响应未完成（已停止）</p>
            ) : null}
          </div>

          <div className="min-w-0 shrink-0 border-t border-brandFaint px-3 py-3">
            <AssistantInput
              value={input}
              onChange={setInput}
              onSend={handleSend}
              onStop={pause}
              streaming={streaming}
              placeholder={
                awaitingConfirm
                  ? '回复「确定」写入规划，或直接说要改的地方'
                  : lastPlanId
                    ? '描述如何调整规划…'
                    : '考研相关问题或调整规划说明…'
              }
            />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default ChatWindow;
