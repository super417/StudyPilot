import { describe, expect, it } from 'vitest';
import { extractChatPractice } from '@/lib/chatPracticeExtract';

describe('extractChatPractice', () => {
  it('extracts 题目 and 答案 sections', () => {
    const parsed = extractChatPractice(
      '下面是一道练习：\n题目：什么是栈？\n答案：后进先出的线性表\n解析：略',
    );
    expect(parsed).toEqual({
      question: '什么是栈？',
      answer: '后进先出的线性表',
    });
  });

  it('returns null when sections cannot be cut', () => {
    expect(extractChatPractice('今天天气不错，去答题吧')).toBeNull();
    expect(extractChatPractice('题目：只有题干没有答案段')).toBeNull();
  });

  it('returns null when missing 题 or 答案 keywords', () => {
    expect(extractChatPractice('Q: 1+1?\nA: 2')).toBeNull();
  });
});
