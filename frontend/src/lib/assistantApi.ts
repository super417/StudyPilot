import { consumeSse } from './sseClient';
import { getModelPrefs } from './modelPrefs';

export interface AssistantChatContext {
  type?: string;
  mistakeId?: string;
  refId?: string;
  hint?: string;
}

export interface AssistantCitation {
  docId: string;
  filename: string;
  chunkIndex: number;
  snippet: string;
}

export interface AssistantChatHandlers {
  onToken?: (delta: string) => void;
  onError?: (code: string, message: string) => void;
  onDone?: (data: { citations?: AssistantCitation[] }) => void;
  onStatus?: (text: string) => void;
}

/** POST /api/assistant/chat — Ai_Proxy SSE token/error/done */
export function streamAssistantChat(
  message: string,
  context: AssistantChatContext | null | undefined,
  handlers: AssistantChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  handlers.onStatus?.('Agent：正在检索知识库并生成回答…');
  const prefs = getModelPrefs();
  const body: Record<string, unknown> = {
    message,
    reasoningStrength: prefs.strength,
  };
  if (context) {
    body.context = {
      type: context.type,
      mistakeId: context.mistakeId,
      refId: context.refId,
      hint: context.hint,
    };
  }

  return consumeSse({
    path: '/api/assistant/chat',
    body,
    signal,
    onEvent: (event, data) => {
      if (event === 'token') {
        handlers.onToken?.(String(data.delta ?? ''));
      } else if (event === 'error') {
        handlers.onError?.(
          String(data.code ?? 'AI_STREAM_ERROR'),
          String(data.message ?? 'AI 响应异常'),
        );
      } else if (event === 'done') {
        const raw = data.citations;
        const citations = Array.isArray(raw)
          ? raw.flatMap((item) => {
              if (!item || typeof item !== 'object') return [];
              const row = item as Record<string, unknown>;
              const snippet = String(row.snippet ?? '');
              if (!snippet) return [];
              return [
                {
                  docId: String(row.docId ?? ''),
                  filename: String(row.filename ?? '资料'),
                  chunkIndex: Number(row.chunkIndex ?? 0),
                  snippet,
                },
              ];
            })
          : [];
        handlers.onDone?.({ citations });
      }
    },
  });
}
