/**
 * 会话存储的抽象接口 + 两个实现。
 *
 * 后端已就绪（`conversations` / `chat_messages` 两张表 + `/api/conversations`），
 * 所以线上走 `ApiConversationRepository`：会话与消息都落库，删除时前后端一起没。
 * `LocalConversationRepository` 保留下来只做一件事 —— 把早期只存在浏览器里的
 * 会话**一次性搬到后端**，搬完就不再被读写（见 `migrateLocalConversationsOnce`）。
 */
import { conversationApi } from './conversationApi';
import type { ChatMessage } from '@/store/assistantStore';

/** 一次对话。消息挂在它下面，删会话即删其全部消息。 */
export interface Conversation {
  id: string;
  /** 取首条用户消息前 12 字；还没有用户消息时是「新对话」 */
  title: string;
  createdAt: number;
  /** 列表排序依据，也是「最近活跃」 */
  updatedAt: number;
  contextType?: 'mistake' | 'plan' | 'free';
}

export interface ConversationRepository {
  list(): Promise<Conversation[]>;
  create(input?: {
    title?: string;
    contextType?: Conversation['contextType'];
  }): Promise<Conversation>;
  remove(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  loadMessages(conversationId: string): Promise<ChatMessage[]>;
  saveMessages(conversationId: string, messages: ChatMessage[]): Promise<void>;
}

const STORAGE_KEY = 'studypilot.conversations.v1';
const MIGRATION_FLAG = 'studypilot.conversations.migrated.v3';

interface Persisted {
  conversations: Conversation[];
  messages: Record<string, ChatMessage[]>;
}

const EMPTY: Persisted = { conversations: [], messages: {} };

function readStore(): Persisted {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { conversations: [], messages: {} };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      messages:
        parsed.messages && typeof parsed.messages === 'object' ? parsed.messages : {},
    };
  } catch {
    // 存储被禁用或内容损坏：当成空库，不要让聊天整体挂掉
    return { ...EMPTY };
  }
}

/**
 * 流式中的消息不落盘。
 * 否则用户在流式过程中刷新，会看到一条永远停在「正在输入」的残句 —— 而且它还会
 * 让下一轮 `appendStreamChunk` 误以为要继续往这条上追加。
 */
function stripStreaming(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const message of messages) {
    if (message.streaming) continue;
    const copy: ChatMessage = { ...message };
    delete copy.streaming;
    out.push(copy);
  }
  return out;
}

/** 只读的旧实现：仅用于把 localStorage 里的存量会话搬到后端。 */
class LocalConversationRepository {
  async list(): Promise<Conversation[]> {
    return readStore().conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async loadMessages(conversationId: string): Promise<ChatMessage[]> {
    return readStore().messages[conversationId] ?? [];
  }
}

/** 线上实现：会话与消息都落后端，删除时前后端一起消失。 */
export class ApiConversationRepository implements ConversationRepository {
  async list(): Promise<Conversation[]> {
    await migrateLocalConversationsOnce();
    return conversationApi.list();
  }

  create(input?: {
    title?: string;
    contextType?: Conversation['contextType'];
  }): Promise<Conversation> {
    return conversationApi.create(input);
  }

  remove(id: string): Promise<void> {
    return conversationApi.remove(id);
  }

  rename(id: string, title: string): Promise<void> {
    return conversationApi.rename(id, title);
  }

  loadMessages(conversationId: string): Promise<ChatMessage[]> {
    return conversationApi.loadMessages(conversationId);
  }

  saveMessages(conversationId: string, messages: ChatMessage[]): Promise<void> {
    return conversationApi.saveMessages(conversationId, stripStreaming(messages));
  }
}

/**
 * 把 localStorage 里的旧会话搬到后端。
 *
 * 三条保护，缺一条都会在真实使用里出问题：
 * 1. **逐条记账**：每搬完一条就把它的本地 id 写进标记，中途失败下次接着搬，
 *    不会把已经搬过的再推一遍（那是「刷新一次多一条」的来源）。
 * 2. **按标题去重**：后端已经有同名会话就跳过 —— 兼容早期版本搬过一半的情况。
 * 3. **只读本地**：搬完不清 localStorage，主人万一想回退还找得回来。
 */
let migration: Promise<void> | null = null;

export function migrateLocalConversationsOnce(): Promise<void> {
  migration ??= runLocalMigration();
  return migration;
}

interface MigrationState {
  pushed: string[];
}

function readMigrationState(): MigrationState {
  try {
    const raw = window.localStorage.getItem(MIGRATION_FLAG);
    if (!raw) return { pushed: [] };
    const parsed = JSON.parse(raw) as Partial<MigrationState>;
    return { pushed: Array.isArray(parsed.pushed) ? parsed.pushed : [] };
  } catch {
    return { pushed: [] };
  }
}

function writeMigrationState(state: MigrationState): void {
  try {
    window.localStorage.setItem(MIGRATION_FLAG, JSON.stringify(state));
  } catch {
    // 隐私模式 / 配额满：这一次没记上，下次可能重复推一条 —— 比丢掉记录强
  }
}

async function runLocalMigration(): Promise<void> {
  try {
    const state = readMigrationState();
    const local = new LocalConversationRepository();
    const stale = await local.list();
    const pending = stale
      .filter((c) => !state.pushed.includes(c.id))
      // 从旧到新推送，后端 updatedAt 才能保持「最近活跃」的先后顺序
      .reverse();
    if (pending.length === 0) return;

    const existingTitles = new Set((await conversationApi.list()).map((c) => c.title));

    for (const conversation of pending) {
      if (!existingTitles.has(conversation.title)) {
        const messages = stripStreaming(await local.loadMessages(conversation.id));
        const created = await conversationApi.create({
          title: conversation.title,
          contextType: conversation.contextType,
        });
        if (messages.length > 0) {
          await conversationApi.saveMessages(created.id, messages);
        }
      }
      state.pushed.push(conversation.id);
      writeMigrationState(state);
    }
  } catch {
    // 后端不可用（未登录 / 网络）时不影响使用：本地数据原样留着，下次再搬。
  }
}

/** 全局单例。 */
export const conversationRepository: ConversationRepository =
  new ApiConversationRepository();

/** 会话标题：取首条用户消息前 12 字，去掉换行。 */
export function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return '新对话';
  const flat = firstUser.content.replace(/\s+/g, ' ').trim();
  return flat.length > 12 ? `${flat.slice(0, 12)}…` : flat || '新对话';
}
