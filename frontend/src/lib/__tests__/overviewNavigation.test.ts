import { afterEach, describe, expect, it, vi } from 'vitest';
import { OVERVIEW_NAVIGATION_EVENT, scrollToLearningOverview } from '../overviewNavigation';

afterEach(() => vi.unstubAllGlobals());

describe('进入个人学习总览', () => {
  it('由页面的滚动控制器处理时，不再触发原生滚动竞争', () => {
    const surface = new EventTarget();
    const scroll = vi.fn();
    surface.addEventListener(OVERVIEW_NAVIGATION_EVENT, (event) => {
      event.preventDefault();
      scroll();
    });
    const getElementById = vi.fn();
    vi.stubGlobal('window', surface);
    vi.stubGlobal('document', { getElementById });
    scrollToLearningOverview();
    expect(scroll).toHaveBeenCalledOnce();
    expect(getElementById).not.toHaveBeenCalled();
  });

  it('未安装滚动控制器时，立即定位个人总览而非介绍区域', () => {
    const scrollIntoView = vi.fn();
    const getElementById = vi.fn((id: string) => id === 'learning-overview' ? { scrollIntoView } : null);
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { getElementById });
    scrollToLearningOverview();
    expect(getElementById).toHaveBeenCalledWith('learning-overview');
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' });
  });

  it('旧版页面仍可落到既有总览锚点', () => {
    const scrollIntoView = vi.fn();
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { getElementById: (id: string) => id === 'overview-content' ? { scrollIntoView } : null });
    scrollToLearningOverview();
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });
});
