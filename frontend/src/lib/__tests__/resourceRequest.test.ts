import { describe, expect, it } from 'vitest';
import { isPlanEditIntent, isResourceRequest } from '@/lib/resourceRequest';

describe('isResourceRequest', () => {
  it('认「找 / 推荐 + 学习资源」的请求', () => {
    expect(isResourceRequest('找具体的学习网站')).toBe(true);
    expect(isResourceRequest('有推荐课程吗')).toBe(true);
    expect(isResourceRequest('帮我找资料')).toBe(true);
    expect(isResourceRequest('推荐几本数学教材')).toBe(true);
    expect(isResourceRequest('给我一个学习路径')).toBe(true);
  });

  it('不把查询类问题当成重排请求', () => {
    expect(isResourceRequest('我上传了哪些资料')).toBe(false);
    expect(isResourceRequest('帮我看看我的资料')).toBe(false);
    expect(isResourceRequest('极限怎么算')).toBe(false);
  });

  it('长段落不触发重排', () => {
    expect(isResourceRequest('找课程'.padEnd(80, '啊'))).toBe(false);
  });
});

describe('isPlanEditIntent', () => {
  it('认改规划的说法', () => {
    expect(isPlanEditIntent('把每天时间改成 3 小时')).toBe(true);
    expect(isPlanEditIntent('调整一下路线图')).toBe(true);
    expect(isPlanEditIntent('极限怎么算')).toBe(false);
  });
});
