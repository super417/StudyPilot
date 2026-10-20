import { describe, expect, it } from 'vitest';

import { mergeGeneratedQuestions } from '@/components/PracticeBoard';
import type { PracticeQuestion } from '@/lib/practiceApi';

const question = (id: string): PracticeQuestion => ({
  id,
  source: 'generated',
  subject: '信息技术',
  question: `题目 ${id}`,
  answer: '答案',
  explanation: '',
  status: 'pending',
  createdAt: '2026-10-20T00:00:00Z',
});

describe('PracticeBoard 生成与判分并发', () => {
  it('生成返回新题时保留已有题目的 id 和实例，供正在判分的卡片继续显示结果', () => {
    const existing = question('already-answering');
    const generated = question('newly-generated');

    const merged = mergeGeneratedQuestions([existing], [generated]);

    expect(merged).toEqual([existing, generated]);
    expect(merged[0]).toBe(existing);
  });

  it('生成结果包含已有题目时不重复渲染卡片', () => {
    const existing = question('already-answering');

    expect(mergeGeneratedQuestions([existing], [existing, question('new')]).map((item) => item.id))
      .toEqual(['already-answering', 'new']);
  });
});
