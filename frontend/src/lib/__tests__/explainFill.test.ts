import { describe, expect, it } from 'vitest';
import { latestExplainReply, splitExplainReply } from '@/lib/explainFill';
import type { ChatMessage } from '@/store/assistantStore';

function msg(role: ChatMessage['role'], content: string, streaming = false): ChatMessage {
  return { id: content.slice(0, 8), role, content, streaming };
}

describe('explainFill', () => {
  it('抽出带错的行当错因，全文当正确理解', () => {
    const fill = splitExplainReply('考点是极限\n容易错的地方：分子分母同阶\n步骤：洛必达');
    expect(fill.whyWrong).toContain('容易错');
    expect(fill.correctUnderstanding).toContain('洛必达');
  });

  it('只认讲题那一轮的完成回复', () => {
    expect(
      latestExplainReply(
        [
          msg('user', '帮我讲这道题：\n1+1'),
          msg('assistant', '考点是加法\n容易错：进位'),
        ],
        false,
      )?.whyWrong,
    ).toContain('容易错');
    expect(
      latestExplainReply(
        [msg('user', '帮我讲这道题：\n1+1'), msg('assistant', '还在说', true)],
        false,
      ),
    ).toBeNull();
    expect(
      latestExplainReply([msg('user', '随便聊聊'), msg('assistant', '好')], false),
    ).toBeNull();
  });
});
