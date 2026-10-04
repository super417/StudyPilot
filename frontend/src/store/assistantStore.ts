/**
 * AI 助手悬浮窗 + 全屏聊天主界面的全局状态（Zustand store）
 *
 * 覆盖需求：
 * - 8.7  会话历史仅保留最近 100 条（**按会话各自计**，不是全局共用 100 条）
 * - 8.10 / 8.11 / 6.6  跨组件带上下文唤起时保留历史
 * - 8.3 / 8.4 / 8.5  视口变化时把悬浮图标重新钳制进视口
 * - 8.8  流式打字机的数据层（appendStreamChunk）
 *
 * 会话化（本轮新增）：消息不再是一个全局数组，而是挂在 `Conversation` 下面。
 * 每次对话自成一条记录，可新建 / 切换 / 删除，落 `lib/conversationRepository.ts`。
 * 悬浮窗和全屏聊天面板**共用这一份状态** —— 在哪儿聊都是同一条会话。
 */
import { create } from 'zustand';
import { clampIconPosition } from './clampIconPosition';
import type { IconPosition, Size } from './clampIconPosition';
import {
  conversationRepository,
  deriveTitle,
  type Conversation,
} from '@/lib/conversationRepository';

export type { IconPosition, Size } from './clampIconPosition';
export type { Conversation } from '@/lib/conversationRepository';

/**
 * 单个会话的消息上限（需求 8.7）。
 * 语义是「每个会话各留 100 条」—— 若按全局 100 条算，老会话会被新会话挤空，
 * 和「每次聊天独立存储」直接冲突。
 */
export const MAX_MESSAGES = 100;

/**
 * 跨组件唤起助手时带入的上下文。
 * 结构灵活：`type` 标记来源场景，`refId` 指向具体实体（如错题 id），
 * `hint` 为可选的自然语言提示。
 */
export interface AssistantContext {
  type: 'mistake' | 'plan' | 'free';
  refId?: string;
  hint?: string;
}

/** 单条聊天消息 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 是否为正在流式接收中的消息 */
  streaming?: boolean;
}

/** 只保留数组末尾最近 `limit` 条（Property 11 / 需求 8.7）。 */
export function trimHistory(messages: ChatMessage[], limit: number): ChatMessage[] {
  return messages.length > limit ? messages.slice(messages.length - limit) : messages;
}

/** 活动会话没有消息时的稳定空数组 —— 每次返回新 `[]` 会让选择器无限重渲染。 */
const EMPTY_MESSAGES: ChatMessage[] = [];

/** 取当前会话的消息。组件用这个，别直接读 `messagesByConversation`。 */
export const selectActiveMessages = (state: AssistantState): ChatMessage[] => {
  const id = state.activeId;
  return (id ? state.messagesByConversation[id] : undefined) ?? EMPTY_MESSAGES;
};

/**
 * 落盘防抖。流式期间每来一个字符都会改 store，但没必要每字符写一次 localStorage；
 * 静默 400ms 后才落一次，既跟得上又不会把主线程写爆。
 */
const saveTimers = new Map<string, number>();

function scheduleSave(conversationId: string, delay = 400): void {
  const existing = saveTimers.get(conversationId);
  if (existing) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    saveTimers.delete(conversationId);
    const { messagesByConversation } = useAssistantStore.getState();
    void conversationRepository.saveMessages(
      conversationId,
      messagesByConversation[conversationId] ?? [],
    );
  }, delay);
  saveTimers.set(conversationId, timer);
}

export interface AssistantState {
  /** 聊天窗口是否展开 */
  open: boolean;
  /** 悬浮图标位置 */
  position: IconPosition;
  /** 当前注入的上下文 */
  context: AssistantContext | null;
  /** 是否正在流式接收 */
  streaming: boolean;

  /** 全部会话，按 updatedAt 倒序 */
  conversations: Conversation[];
  /** 当前会话 id；null = 还没有任何会话 */
  activeId: string | null;
  /** 会话 id → 消息列表。切换会话时按需懒加载 */
  messagesByConversation: Record<string, ChatMessage[]>;
  /** 是否已从 repository 载入过 */
  hydrated: boolean;
  /** 打开助手后由聊天窗取走并发送的一句；用完即清 */
  queuedPrompt: string | null;

  /** 从 repository 载入会话列表与最近一条会话的消息 */
  hydrate: () => Promise<void>;
  /** 新建一条会话并设为活动 */
  startConversation: (ctx?: AssistantContext) => Promise<string | null>;
  /** 切到某条会话（消息未载入时自动拉取） */
  switchConversation: (id: string) => Promise<void>;
  /** 删除会话；删的是当前会话时自动切到最近一条 */
  deleteConversation: (id: string) => Promise<void>;
  /** 保证有活动会话，没有就建一条 */
  ensureConversation: () => Promise<void>;

  /** 仅打开窗口 */
  openAssistant: () => void;
  /** 关闭窗口，不清历史 */
  closeAssistant: () => void;
  /** 开关切换 */
  toggleAssistant: () => void;
  /** 打开窗口 + 覆盖上下文 + 保留历史（需求 8.10 / 8.11 / 6.6） */
  openAssistantWithContext: (ctx: AssistantContext) => void;
  /** 排队一句，等会话就绪后由聊天窗发送 */
  queuePrompt: (text: string) => void;
  /** 设置上下文 */
  setContext: (ctx: AssistantContext) => void;
  /** 清除上下文 */
  clearContext: () => void;
  /** 设置图标位置 */
  setPosition: (pos: IconPosition) => void;
  /** 用纯函数把当前 position 钳制进视口（需求 8.3 / 8.4 / 8.5） */
  clampPosition: (viewport: Size, iconSize: Size) => void;
  /** 往当前会话追加消息并裁剪到最近 MAX_MESSAGES 条（需求 8.7） */
  addMessage: (msg: ChatMessage) => void;
  /** 打字机数据层：把 chunk 追加到当前会话末尾的流式消息（需求 8.8） */
  appendStreamChunk: (chunk: string) => void;
  /** 设置流式状态 */
  setStreaming: (v: boolean) => void;
  /** 结束流式，把末尾流式消息标记为已完成并落盘 */
  stopStreaming: () => void;
}

/**
 * 并发闸门。
 *
 * `hydrate` 与 `ensureConversation` 会被多条路径同时触发 —— React StrictMode
 * 双调用 effect、连点悬浮图标、进演示页时的 `await hydrate(); await ensureConversation();`。
 * 没有闸门时两次调用都会读到「还没有会话」，于是各建一条空会话：
 * 表现就是**刷新一次，聊天记录里多一条「新对话」**。
 */
let hydrating: Promise<void> | null = null;
let ensuring: Promise<void> | null = null;

export const useAssistantStore = create<AssistantState>((set, get) => ({
  open: false,
  position: { x: 0, y: 0 },
  context: null,
  streaming: false,

  conversations: [],
  activeId: null,
  messagesByConversation: {},
  hydrated: false,
  queuedPrompt: null,

  hydrate: () => {
    hydrating ??= (async () => {
      try {
        const conversations = await conversationRepository.list();
        set({ conversations, hydrated: true });
        if (conversations.length === 0) return;

        const id = conversations[0].id;
        const messages = await conversationRepository.loadMessages(id);
        set((state) => ({
          activeId: state.activeId ?? id,
          messagesByConversation: { ...state.messagesByConversation, [id]: messages },
        }));
      } catch {
        // 后端不可用（未登录 / 断网）时不能卡在「加载中」：标记已尝试，
        // 用户仍可新建会话，失败会在他点发送时以具体错误暴露出来。
        set({ hydrated: true });
      } finally {
        hydrating = null;
      }
    })();
    return hydrating;
  },

  startConversation: async (ctx) => {
    const conversation = await conversationRepository.create({
      contextType: ctx?.type,
    });
    set((state) => ({
      conversations: [conversation, ...state.conversations],
      activeId: conversation.id,
      messagesByConversation: { ...state.messagesByConversation, [conversation.id]: [] },
      context: ctx ?? null,
    }));
    return conversation.id;
  },

  switchConversation: async (id) => {
    set({ activeId: id });
    if (get().messagesByConversation[id]) return;
    const messages = await conversationRepository.loadMessages(id);
    set((state) => ({
      messagesByConversation: { ...state.messagesByConversation, [id]: messages },
    }));
  },

  deleteConversation: async (id) => {
    await conversationRepository.remove(id);
    set((state) => {
      const conversations = state.conversations.filter((c) => c.id !== id);
      const messagesByConversation = { ...state.messagesByConversation };
      delete messagesByConversation[id];
      return {
        conversations,
        messagesByConversation,
        activeId: state.activeId === id ? (conversations[0]?.id ?? null) : state.activeId,
      };
    });

    // 删掉的若是当前会话，上一步已把 activeId 切到最近一条 —— 那条的消息可能还没载入
    const next = get().activeId;
    if (next && !get().messagesByConversation[next]) {
      await get().switchConversation(next);
    }
  },

  ensureConversation: () => {
    ensuring ??= (async () => {
      try {
        const { activeId, conversations } = get();
        if (activeId && conversations.some((c) => c.id === activeId)) return;
        if (conversations.length > 0) {
          await get().switchConversation(conversations[0].id);
          return;
        }

        // 本地没会话 ≠ 后端没有：上一次 hydrate 可能失败了（重启后端、断网）。
        // 直接新建会凭空多出一条空会话，所以先重新拉一次再决定。
        await get().hydrate();
        const fresh = get();
        if (fresh.conversations.length > 0) {
          await fresh.switchConversation(fresh.conversations[0].id);
          return;
        }
        await get().startConversation();
      } finally {
        ensuring = null;
      }
    })();
    return ensuring;
  },

  openAssistant: () => {
    set({ open: true });
    void get()
      .ensureConversation()
      .catch(() => undefined);
  },

  closeAssistant: () => set({ open: false }),

  toggleAssistant: () => {
    const next = !get().open;
    set({ open: next });
    if (next) {
      void get()
        .ensureConversation()
        .catch(() => undefined);
    }
  },

  openAssistantWithContext: (ctx) => {
    // 保留消息，仅打开并覆盖上下文（需求 8.10 / 8.11 / 6.6）
    set({ open: true, context: ctx });
    void get()
      .ensureConversation()
      .catch(() => undefined);
  },

  queuePrompt: (text) => {
    const cleaned = text.trim();
    if (cleaned) set({ queuedPrompt: cleaned });
  },

  setContext: (ctx) => set({ context: ctx }),

  clearContext: () => set({ context: null }),

  setPosition: (pos) => set({ position: pos }),

  clampPosition: (viewport, iconSize) =>
    set((state) => ({
      position: clampIconPosition(state.position, viewport, iconSize),
    })),

  addMessage: (msg) => {
    const id = get().activeId;
    if (!id) return;

    const titleBefore = get().conversations.find((c) => c.id === id)?.title;

    set((state) => {
      const list = trimHistory(
        [...(state.messagesByConversation[id] ?? []), msg],
        MAX_MESSAGES,
      );
      return {
        messagesByConversation: { ...state.messagesByConversation, [id]: list },
        conversations: state.conversations.map((c) =>
          c.id === id
            ? {
                ...c,
                updatedAt: Date.now(),
                // 只有还没被命名过、且来的是用户消息时才自动起标题
                title:
                  c.title === '新对话' && msg.role === 'user'
                    ? deriveTitle(list)
                    : c.title,
              }
            : c,
        ),
      };
    });

    // 标题是派生出来的，得单独推给后端 —— 否则刷新后列表又变回「新对话」。
    const titleAfter = get().conversations.find((c) => c.id === id)?.title;
    if (titleAfter && titleAfter !== titleBefore) {
      void conversationRepository.rename(id, titleAfter).catch(() => undefined);
    }

    scheduleSave(id);
  },

  appendStreamChunk: (chunk) => {
    const id = get().activeId;
    if (!id) return;

    set((state) => {
      const list = state.messagesByConversation[id] ?? [];
      const last = list[list.length - 1];

      // 末尾存在正在流式的 assistant 消息 → 追加内容
      if (last && last.role === 'assistant' && last.streaming) {
        const updated = [...list.slice(0, -1), { ...last, content: last.content + chunk }];
        return {
          messagesByConversation: {
            ...state.messagesByConversation,
            [id]: trimHistory(updated, MAX_MESSAGES),
          },
          streaming: true,
        };
      }

      // 否则新建一条流式 assistant 消息
      const created: ChatMessage = {
        id: `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: chunk,
        streaming: true,
      };
      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [id]: trimHistory([...list, created], MAX_MESSAGES),
        },
        streaming: true,
      };
    });

    // 流式期间不落盘（每字符一次太频繁），收尾由 stopStreaming 统一保存
  },

  setStreaming: (v) => set({ streaming: v }),

  stopStreaming: () => {
    const id = get().activeId;
    set((state) => {
      if (!id) return { streaming: false };
      const list = state.messagesByConversation[id] ?? [];
      const last = list[list.length - 1];
      if (!last || !last.streaming) return { streaming: false };
      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [id]: [...list.slice(0, -1), { ...last, streaming: false }],
        },
        streaming: false,
      };
    });
    if (id) scheduleSave(id, 0);
  },
}));
