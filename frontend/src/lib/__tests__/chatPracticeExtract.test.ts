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

  it('extracts 判断题 via type heading + blockquote stem', () => {
    const parsed = extractChatPractice(
      [
        '## 判断题',
        '> 只要数据量足够大，过拟合问题就会自然消失。',
        '**参考答案：错误。**',
      ].join('\n'),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.question).toContain('只要数据量足够大');
    expect(parsed!.question).not.toMatch(/^##?\s*判断题/);
    expect(parsed!.answer).toMatch(/^错误/);
  });

  it('extracts 选择题 via type heading', () => {
    const parsed = extractChatPractice(
      [
        '## 选择题',
        '下列哪种结构是后进先出？',
        'A. 队列',
        'B. 栈',
        'C. 数组',
        '**参考答案：B**',
        '解析：栈是 LIFO。',
      ].join('\n'),
    );
    expect(parsed).toEqual({
      question: '下列哪种结构是后进先出？\nA. 队列\nB. 栈\nC. 数组',
      answer: 'B',
    });
  });
});
