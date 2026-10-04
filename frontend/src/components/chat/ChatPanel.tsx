/**
 * 左侧毛玻璃聊天框 —— 全屏聊天主界面的对话区。
 *
 * 玻璃质感复用个人中心那套 `.liquid-glass`（浅色半透明 + backdrop 强模糊 + 镜面高光），
 * 输入框复用悬浮窗的 `AssistantInput`，两处是同一个组件而不是"长得像"。
 *
 * 顶部工具栏收纳了原本浮在页面上的两个演示入口（看看它怎么工作 / 收一条学习通知）
 * —— 它们弹出聊天框后被盖住了，不留个去处就等于丢了功能。
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Bell, CalendarRange, MessageSquarePlus, Workflow, X } from 'lucide-react';
import { selectActiveMessages, useAssistantStore } from '@/store';
import { usePlanSessionStore } from '@/store/planSessionStore';
import GoalSubmitForm from '@/components/planner/GoalSubmitForm';
import AssistantInput from '@/components/chat/AssistantInput';
import AssistantMessage from '@/components/chat/AssistantMessage';
import UserMessage from '@/components/chat/UserMessage';
import { useAssistantChat } from '@/hooks/useAssistantChat';
import { isPauseRequest } from '@/lib/pauseRequest';

const CONTEXT_LABEL: Record<'mistake' | 'plan' | 'free', string> = {
  mistake: '错题',
  plan: '学习规划',
  free: '自由提问',
};

export interface ChatPanelProps {
  onClose: () => void;
  /** 打开 Agent 工作流演示（原本是页面上的 pill） */
  onShowWorkflow: () => void;
  /** 打开站内信卡片（原本是页面上的 pill） */
  onShowNotice: () => void;
}

function ChatPanel({ onClose, onShowWorkflow, onShowNotice }: ChatPanelProps) {
  const context = useAssistantStore((s) => s.context);
  const messages = useAssistantStore(selectActiveMessages);
  const setContext = useAssistantStore((s) => s.setContext);
  const clearContext = useAssistantStore((s) => s.clearContext);
  const startConversation = useAssistantStore((s) => s.startConversation);
  const lastPlanId = usePlanSessionStore((s) => s.lastPlanId);
  const awaitingConfirm = usePlanSessionStore((s) => s.awaitingConfirm);
  const { send, resend, stop, pause, streaming, interrupted } = useAssistantChat();

  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const showPlanForm = context?.type === 'plan';

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || (streaming && !isPauseRequest(text))) return;
    setInput('');
    send(text);
  };

  const handleNewChat = () => {
    if (streaming) stop();
    setInput('');
    void startConversation();
  };

  return (
    <motion.aside
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-none fixed inset-y-0 left-0 z-20 w-full pt-20 pb-6 pl-6 pr-3 sm:w-[min(560px,46vw)]"
    >
      {/*
        pointer-events：外层这圈 padding（顶部 80px）是留给顶部导航的，必须让点击穿过去。
        不透传的话，聊天框一开，左上角的 logo 和导航链接就全点不动了 —— 而且看不出原因。
      */}
      <div className="liquid-glass pointer-events-auto flex h-full flex-col rounded-[28px]">
        <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-medium text-brandDark">学习助手</h2>
            <p className="mt-0.5 truncate text-[12px] text-brandDark/55">
              {context ? `正在讨论：${CONTEXT_LABEL[context.type]}` : '自由提问'}
              {context?.hint ? `（${context.hint}）` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handleNewChat}
              aria-label="开启新聊天"
              title="开启新聊天"
              className="rounded-full p-1.5 text-brandDark/70 transition-colors hover:bg-white/70 hover:text-brandDark"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (showPlanForm) {
                  clearContext();
                  return;
                }
                setContext({ type: 'plan', hint: '制定或调整考研复习规划' });
              }}
              aria-label={showPlanForm ? '收起考研目标表单' : '提交考研学习目标'}
              title={showPlanForm ? '收起目标表单（聊天继续）' : '提交考研学习目标'}
              aria-pressed={showPlanForm}
              className={`rounded-full p-1.5 transition-colors hover:bg-white/70 ${
                showPlanForm ? 'bg-white/80 text-brandDark' : 'text-brandDark/70'
              }`}
            >
              <CalendarRange className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onShowWorkflow}
              aria-label="看看它怎么工作"
              title="看看它怎么工作"
              className="rounded-full p-1.5 text-brandDark/70 transition-colors hover:bg-white/70 hover:text-brandDark"
            >
              <Workflow className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onShowNotice}
              aria-label="收一条学习通知"
              title="收一条学习通知"
              className="rounded-full p-1.5 text-brandDark/70 transition-colors hover:bg-white/70 hover:text-brandDark"
            >
              <Bell className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭聊天"
              title="关闭"
              className="rounded-full p-1.5 text-brandDark/70 transition-colors hover:bg-white/70 hover:text-brandDark"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {showPlanForm ? <GoalSubmitForm onDismiss={clearContext} /> : null}

        <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {messages.length === 0 ? (
            <p className="pt-10 text-center text-[13px] leading-relaxed text-brandDark/45">
              问点考研相关的，或者说说你想怎么调整复习计划
              <br />
              <span className="mt-2 inline-block text-[12px]">
                支持知识库摘录 · 规划 Agent · 引用溯源
              </span>
            </p>
          ) : null}

          {messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === 'user'
                  ? 'flex w-full min-w-0 justify-end'
                  : 'flex w-full min-w-0 justify-start'
              }
            >
              {m.role === 'user' ? (
                <UserMessage
                  message={m}
                  bubbleClassName="whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brandDark px-3.5 py-2.5 text-[13.5px] leading-relaxed text-white"
                  onResend={resend}
                />
              ) : (
                <AssistantMessage
                  message={m}
                  bubbleClassName="whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-white/80 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-brandDark"
                  onResend={resend}
                />
              )}
            </div>
          ))}

          {interrupted ? (
            <p className="text-center text-[12px] text-dangerText">响应未完成（已停止）</p>
          ) : null}
        </div>

        <div className="px-4 pb-4">
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
      </div>
    </motion.aside>
  );
}

export default ChatPanel;
