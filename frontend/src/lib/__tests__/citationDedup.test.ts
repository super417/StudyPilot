import { describe, expect, it } from 'vitest';
import { groupCitations } from '../citationDedup';

describe('资料来源去重', () => {
  it('合并不同上传中的相同摘录，保留同名不同内容和不同文件', () => {
    const a = { docId: 'a', filename: 'notes.pdf', chunkIndex: 0, snippet: '相同内容' };
    const b = { ...a, docId: 'b' };
    const c = { ...a, docId: 'c', snippet: '不同内容' };
    const d = { ...a, docId: 'd', filename: 'other.pdf' };
    expect(groupCitations([a, b, c, d])).toEqual([
      { filename: 'notes.pdf', snippets: ['相同内容', '不同内容'] },
      { filename: 'other.pdf', snippets: ['相同内容'] },
    ]);
  });
});
