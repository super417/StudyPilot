import type { ChatMessage } from '@/store/assistantStore';

export const EXPLAIN_PROMPT_PREFIX = '帮我讲这道题';

export interface ExplainFill {
  whyWrong: string;
  correctUnderstanding: string;
}

/** 从讲解里抽出带「错」的几行当错因，全文当正确理解。 */
export function splitExplainReply(text: string): ExplainFill {
  const cleaned = text.trim();
  const whyWrong = cleaned
    .split(/\n+/)
    .filter((line) => /错因|容易错|易错|错在|误区|不对/.test(line))
    .join('\n')
    .slice(0, 500);
  return { whyWrong, correctUnderstanding: cleaned };
}

/** 最近一次「帮我讲这道题」后面那条已完成的助手回复。流式中不算。 */
export function latestExplainReply(
  messages: ChatMessage[],
  streaming: boolean,
): ExplainFill | null {
  if (streaming) return null;
  for (let i = messages.length - 1; i >= 1; i -= 1) {
    const assistant = messages[i];
    const user = messages[i - 1];
    if (assistant.role !== 'assistant' || assistant.streaming) continue;
    if (user.role !== 'user' || !user.content.startsWith(EXPLAIN_PROMPT_PREFIX)) continue;
    const text = assistant.content.trim();
    return text ? splitExplainReply(text) : null;
  }
  return null;
}
