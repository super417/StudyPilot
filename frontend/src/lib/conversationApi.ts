/**
 * 会话历史的 HTTP 客户端（`/api/conversations`）。
 *
 * 与后端表一一对应：`conversations`（会话）+ `chat_messages`（消息）。
 * 删除是**真删** —— 后端连消息一起清掉，前端再把它从 store 里摘掉，
 * 两侧同时消失，刷新后不会「复活」。
 *
 * 时间戳在后端是 ISO 字符串，这里统一转成毫秒数，保持与前端 store 的
 * `Conversation.createdAt / updatedAt` 语义一致。
 */
import { apiRequest } from './httpClient';
import type { ChatMessage } from '@/store/assistantStore';
import type { Conversation } from './conversationRepository';

interface ConversationDto {
  id: string;
  title: string;
  contextType: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MessageDto {
  id: string;
  role: string;
  content: string;
}

function toConversation(dto: ConversationDto): Conversation {
  return {
    id: dto.id,
    title: dto.title,
    contextType: (dto.contextType ?? undefined) as Conversation['contextType'],
    createdAt: Date.parse(dto.createdAt),
    updatedAt: Date.parse(dto.updatedAt),
  };
}

function toMessage(dto: MessageDto): ChatMessage {
  return {
    id: dto.id,
    role: dto.role === 'user' ? 'user' : 'assistant',
    content: dto.content,
  };
}

function conversationPath(id: string): string {
  return `/api/conversations/${encodeURIComponent(id)}`;
}

export const conversationApi = {
  async list(): Promise<Conversation[]> {
    const body = await apiRequest<{ conversations: ConversationDto[] }>(
      '/api/conversations',
    );
    return body.conversations.map(toConversation);
  },

  async create(input?: {
    title?: string;
    contextType?: Conversation['contextType'];
  }): Promise<Conversation> {
    const body = await apiRequest<{ conversation: ConversationDto }>(
      '/api/conversations',
      {
        method: 'POST',
        body: JSON.stringify({
          title: input?.title,
          contextType: input?.contextType ?? null,
        }),
      },
    );
    return toConversation(body.conversation);
  },

  async rename(id: string, title: string): Promise<void> {
    await apiRequest(conversationPath(id), {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  },

  async remove(id: string): Promise<void> {
    await apiRequest(conversationPath(id), { method: 'DELETE' });
  },

  async loadMessages(id: string): Promise<ChatMessage[]> {
    const body = await apiRequest<{ messages: MessageDto[] }>(
      `${conversationPath(id)}/messages`,
    );
    return body.messages.map(toMessage);
  },

  /** 整体替换该会话的消息（前端持有完整 transcript，不做增量 diff）。 */
  async saveMessages(id: string, messages: ChatMessage[]): Promise<void> {
    await apiRequest(`${conversationPath(id)}/messages`, {
      method: 'PUT',
      body: JSON.stringify({
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
  },
};
