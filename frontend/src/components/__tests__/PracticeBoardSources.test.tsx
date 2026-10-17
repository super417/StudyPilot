import { describe, expect, it } from 'vitest';

import {
  hasVisibleSourceRefs,
  sourceRefSummary,
} from '@/components/PracticeBoard';

describe('PracticeBoard 出处展示', () => {
  it('sourceRefs 为 null 或空数组时不显示出处区块', () => {
    expect(hasVisibleSourceRefs(null)).toBe(false);
    expect(hasVisibleSourceRefs(undefined)).toBe(false);
    expect(hasVisibleSourceRefs([])).toBe(false);
  });

  it('有 sourceRefs 时摘要为文件名 + 段号', () => {
    expect(hasVisibleSourceRefs([{
      docId: 'notes',
      filename: '笔记.txt',
      chunkIndex: 0,
      snippet: '先序+中序',
      score: 1,
    }])).toBe(true);
    expect(
      sourceRefSummary({
        docId: 'notes',
        filename: '笔记.txt',
        chunkIndex: 0,
        snippet: '先序+中序',
      }),
    ).toBe('出自《笔记.txt》第 1 段');
  });
});
