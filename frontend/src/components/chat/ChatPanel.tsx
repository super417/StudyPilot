/**
 * 左侧毛玻璃聊天框 —— 全屏聊天主界面的对话区。
 *
 * 玻璃质感复用个人中心那套 `.liquid-glass`（浅色半透明 + backdrop 强模糊 + 镜面高光），
 * 输入框复用悬浮窗的 `AssistantInput`，两处是同一个组件而不是"长得像"。
 *
 * 顶部工具栏收纳了原本浮在页面上的两个演示入口（看看它怎么工作 / 收一条学习通知）
 * —— 它们弹出聊天框后被盖住了，不留个去处就等于丢了功能。
 */
import { motion } from 'framer-motion';
import { Bell, CalendarRange, MessageSquarePlus, Workflow, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { selectActiveMessages, useAssistantStore } from '@/store';
import { usePlanSessionStore } from '@/store/planSessionStore';
import AdjustmentPreviewBar from '@/components/assistant/AdjustmentPreviewBar';
import AssistantNamePrompt from '@/components/assistant/AssistantNamePrompt';
import GoalSubmitForm from '@/components/planner/GoalSubmitForm';
import AssistantInput from '@/components/chat/AssistantInput';
import AssistantMessage from '@/components/chat/AssistantMessage';
import ModelEffortMenu from '@/components/chat/ModelEffortMenu';
import UserMessage from '@/components/chat/UserMessage';
import { useAssistantChat } from '@/hooks/useAssistantChat';
import { useStickToBottom } from '@/hooks/useStickToBottom';
import { isPauseRequest } from '@/lib/pauseRequest';
import { displayAssistantName, fetchBasicProfile, getBasicProfile } from '@/lib/profilePrefs';
import ningning from '@/assets/chat-girl-idle.png';

const CONTEXT_LABEL: Record<'mistake' | 'plan' | 'free', string> = {
  mistake: '错题',
  plan: '学习规划',
  free: '自由提问',
};

const PANEL_MIN_W = 320;
/**
 * 参考图定稿：面板约占视口 55%，右侧留出大块绿景给场景人物。
 * 拖拽手柄仍可拉到 85%，只是默认不再铺满。
 */
const PANEL_DEFAULT_RATIO = 0.55;
const PANEL_MAX_RATIO = 0.85;
/** 超宽屏别把面板拉到荒唐的宽度，留一点上限。 */
const PANEL_ABS_MAX_W = 1680;

/** 与原总览页「开始今天的学习」同一句话，保证助手拿到的是同一条指令。 */
const START_TODAY_PROMPT = '开始今天 60 分钟学习';

/** 空会话时的问候语，按本机时间分档（对齐 LobeHub 首屏那句 Good afternoon）。 */
function greetingWord(hour: number): string {
  if (hour < 5) return '凌晨好';
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function panelMaxWidth(viewport = typeof window !== 'undefined' ? window.innerWidth : 1280): number {
  return Math.min(PANEL_ABS_MAX_W, Math.floor(viewport * PANEL_MAX_RATIO));
}

function panelDefaultWidth(viewport = typeof window !== 'undefined' ? window.innerWidth : 1280): number {
  return Math.min(PANEL_ABS_MAX_W, Math.floor(viewport * PANEL_DEFAULT_RATIO));
}

function clampPanelWidth(width: number, viewport = window.innerWidth): number {
  return Math.min(panelMaxWidth(viewport), Math.max(PANEL_MIN_W, Math.round(width)));
}

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

  const input = useAssistantStore((s) => s.composerDraft);
  const setInput = useAssistantStore((s) => s.setComposerDraft);
  const showPlanForm = context?.type === 'plan';
  /** 「开始今天」快捷指令常驻输入条下沿左侧（像参考图那个 Agent 入口），生成中隐藏。 */
  const showStartCta = !streaming;
  const contentKey = `${messages.length}:${messages[messages.length - 1]?.content.length ?? 0}`;
  const { listRef, onScroll, pinToBottom } = useStickToBottom(true, contentKey);

  const [panelWidth, setPanelWidth] = useState(() =>
    typeof window === 'undefined' ? 560 : clampPanelWidth(panelDefaultWidth()),
  );
  const [assistantTitle, setAssistantTitle] = useState(() =>
    displayAssistantName(getBasicProfile().assistantName),
  );
  const [nickname, setNickname] = useState(() => getBasicProfile().nickname);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    // 资料页改名后本地缓存已更新；全屏聊天挂载时同步标题（不另发 GET）。
    const profile = getBasicProfile();
    setAssistantTitle(displayAssistantName(profile.assistantName));
    setNickname(profile.nickname);
    // 首次进站时缓存可能还没落盘（问候语会少个名字）：补一次带 dedupe 的拉取。
    void fetchBasicProfile()
      .then((next) => {
        setAssistantTitle(displayAssistantName(next.assistantName));
        setNickname(next.nickname);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onWinResize = () => setPanelWidth((w) => clampPanelWidth(w));
    window.addEventListener('resize', onWinResize);
    return () => window.removeEventListener('resize', onWinResize);
  }, []);

  const onPointerMove = useCallback((event: PointerEvent) => {
    const drag = resizeRef.current;
    if (!drag) return;
    setPanelWidth(clampPanelWidth(drag.startWidth + (event.clientX - drag.startX)));
  }, []);

  const endResize = useCallback(() => {
    resizeRef.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endResize);
    document.body.style.removeProperty('cursor');
    document.body.style.removeProperty('user-select');
  }, [onPointerMove]);

  const startResize = (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = { startX: event.clientX, startWidth: panelWidth };
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endResize);
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
    <motion.aside
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      style={{ width: panelWidth }}
      className="pointer-events-none fixed inset-y-0 left-0 z-20 max-w-[100vw] pt-24 pb-16 pl-6 pr-3"
    >
      {/*
        pointer-events：外层这圈 padding（上 96px / 下 64px）是留给顶部导航和底部呼吸空间的，必须让点击穿过去。
        不透传的话，聊天框一开，左上角的 logo 和导航链接就全点不动了 —— 而且看不出原因。
      */}
      <div className="liquid-glass pointer-events-auto relative flex h-full min-w-0 flex-col rounded-[28px]">
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整聊天框宽度"
          aria-valuemin={PANEL_MIN_W}
          aria-valuemax={panelMaxWidth()}
          aria-valuenow={panelWidth}
          onPointerDown={startResize}
          className="absolute inset-y-4 -right-1 z-10 w-3 cursor-ew-resize touch-none rounded-full hover:bg-brandDark/10"
        />
        <header className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-medium text-brandDark">{assistantTitle}</h2>
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
                setContext({ type: 'plan', hint: '制定或调整复习规划' });
              }}
              aria-label={showPlanForm ? '收起学习目标表单' : '提交学习目标'}
              title={showPlanForm ? '收起目标表单（聊天继续）' : '提交学习目标'}
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

        <AssistantNamePrompt
          active
          onResolved={(name) => setAssistantTitle(displayAssistantName(name))}
        />

        {showPlanForm ? (
          <div className="min-h-0 max-h-[38%] shrink-0 overflow-y-auto overflow-x-hidden">
            <GoalSubmitForm onDismiss={clearContext} />
          </div>
        ) : null}

        <div
          ref={listRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto px-5 py-4"
        >
          {messages.length === 0 ? (
            <div className="pt-3">
              <h2 className="font-display text-[30px] font-semibold leading-tight text-brandDark">
                {greetingWord(new Date().getHours())}
                {nickname ? `，${nickname}` : ''}
              </h2>
              <p className="mt-2.5 max-w-[52ch] text-[13px] leading-relaxed text-brandDark/50">
                问点学习相关的，或者说说你想怎么调整复习计划。
                <br />
                支持知识库摘录 · 规划 Agent · 引用溯源
              </p>
            </div>
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
                  bubbleClassName="rounded-2xl rounded-bl-sm bg-white/80 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-brandDark"
                  onResend={resend}
                />
              )}
            </div>
          ))}

          {interrupted ? (
            <p className="text-center text-[12px] text-dangerText">响应未完成（已停止）</p>
          ) : null}
        </div>

        <AdjustmentPreviewBar
          onNotice={(text) =>
            useAssistantStore.getState().addMessage({
              id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              role: 'assistant',
              content: text,
            })
          }
        />
        {/*
          输入条下沿的控制行（对齐 LobeHub 那个 composer）：
          左边星标 + 「开始今天」快捷指令，右边模型入口 + 发送钮。
        */}
        <div className="min-w-0 shrink-0 px-4 pb-4">
          <AssistantInput
            variant="stacked"
            leading={
              showStartCta ? (
                <button
                  type="button"
                  onClick={() => {
                    pinToBottom();
                    send(START_TODAY_PROMPT);
                  }}
                  className="assistant-input-cta"
                >
                  {START_TODAY_PROMPT}
                </button>
              ) : null
            }
            controls={<ModelEffortMenu />}
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
                  : '学习相关问题或调整规划说明…'
            }
          />
        </div>
      </div>

      {/*
        右侧窄绿缝里的人物（项目内的 ningning，同一张 chat-girl-idle）：
        贴着面板右外沿、脚落在面板底线上，取 LobeHub「人物站在侧栏外沿」那套构图。
        她整张图都在面板外面 —— 不压主文案、不压发送钮，也不吃鼠标事件。
      */}
      <img
        src={ningning}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none absolute bottom-16 hidden select-none md:block"
        style={{
          left: '100%',
          height: 'clamp(200px, 30vh, 280px)',
          width: 'auto',
          // 绿缝不够宽时按比例缩、并且始终贴地，别把人挤成一条
          maxWidth: 'calc(100vw - 100% - 12px)',
          objectFit: 'contain',
          objectPosition: 'bottom',
          filter: 'drop-shadow(0 18px 24px rgba(0, 0, 0, 0.38))',
        }}
      />
    </motion.aside>
  );
}

export default ChatPanel;
