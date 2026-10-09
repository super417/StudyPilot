import { describe, expect, it } from 'vitest';

import { parseAssistantBlocks, stripAssistantMarkup } from '@/lib/assistantMarkdown';

describe('parseAssistantBlocks', () => {
  it('按空行分段，不按句号拆段', () => {
    const blocks = parseAssistantBlocks('第一句。第二句还在同一段。\n\n下一段。');
    expect(blocks).toEqual([
      { type: 'p', text: '第一句。第二句还在同一段。' },
      { type: 'p', text: '下一段。' },
    ]);
  });

  it('识别列表、标题和代码块', () => {
    const blocks = parseAssistantBlocks(
      '## 建议\n\n- 先做基础\n- 再做真题\n\n```c\nint n;\n```\n',
    );
    expect(blocks[0]).toEqual({ type: 'h', level: 2, text: '建议' });
    expect(blocks[1]).toEqual({ type: 'ul', items: ['先做基础', '再做真题'] });
    expect(blocks[2]).toEqual({ type: 'pre', lang: 'c', code: 'int n;' });
  });
});

describe('stripAssistantMarkup', () => {
  it('朗读时去掉加粗和列表记号', () => {
    expect(stripAssistantMarkup('**重点**\n- 一项')).toBe('重点\n一项');
  });
});
