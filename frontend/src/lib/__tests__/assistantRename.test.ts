import { describe, expect, it } from 'vitest';
import { extractAssistantRename } from '../assistantRename';

describe('聊天改名意图', () => {
  it('识别明确的改名表达', () => {
    expect(extractAssistantRename('那我以后就叫你宁宁怎么样')).toBe('宁宁');
    expect(extractAssistantRename('把你的名字改成小明')).toBe('小明');
    expect(extractAssistantRename('以后叫你「宁宁」')).toBe('宁宁');
  });
  it('不把问题或带其他内容的句子当作改名', () => {
    expect(extractAssistantRename('我应该叫你什么？')).toBeNull();
    expect(extractAssistantRename('叫你宁宁是什么意思')).toBeNull();
    expect(extractAssistantRename('叫你宁宁，然后帮我规划')).toBeNull();
  });
});
