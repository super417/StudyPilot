import { describe, expect, it } from 'vitest';

import {
  isMainframeChatExpand,
  isMainframeRoute,
} from '@/lib/mainframeRoute';

describe('mainframeRoute', () => {
  it('普通入口只认 #/mainframe，不当成从小窗展开', () => {
    expect(isMainframeRoute('#/mainframe')).toBe(true);
    expect(isMainframeChatExpand('#/mainframe')).toBe(false);
    expect(isMainframeChatExpand('#/mainframe?foo=1')).toBe(false);
  });

  it('小窗展开用 from=widget 标记', () => {
    expect(isMainframeRoute('#/mainframe?from=widget')).toBe(true);
    expect(isMainframeChatExpand('#/mainframe?from=widget')).toBe(true);
  });
});
