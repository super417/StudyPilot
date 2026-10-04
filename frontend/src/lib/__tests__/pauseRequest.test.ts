import { describe, expect, it } from 'vitest';
import { isPauseRequest } from '@/lib/pauseRequest';

describe('isPauseRequest', () => {
  it('只认暂停指令', () => {
    expect(isPauseRequest('暂停')).toBe(true);
    expect(isPauseRequest('请停止。')).toBe(true);
    expect(isPauseRequest('pause')).toBe(true);
    expect(isPauseRequest('暂停一下复习计划')).toBe(false);
    expect(isPauseRequest('极限怎么停')).toBe(false);
  });
});
