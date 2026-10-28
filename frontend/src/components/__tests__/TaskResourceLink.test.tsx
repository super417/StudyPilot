import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TaskResourceLink from '../TaskResourceLink';
import { LearningModuleCard } from '@/pages/PhaseDetailPage';
import type { DailyTask } from '@/mocks/types';

describe('legacy Roadmap resource links', () => {
  it.each(['https://www.xuetangx.com/', 'https://www.bilibili.com/?from=roadmap', 'https://www.bilibili.com/#video', 'https://www.xuetangx.com/course/'])('hides %s', (resourceUrl) => {
    expect(renderToStaticMarkup(createElement(TaskResourceLink, { task: { resourceUrl } as DailyTask }))).toBe('');
    const detail = renderToStaticMarkup(createElement(LearningModuleCard, { task: { resourceUrl } as DailyTask, index: 0 }));
    expect(detail).not.toContain('打开学习资源');
    expect(detail).not.toContain('href=');
  });
  it.each(['https://www.bilibili.com/video/BV1Ti421v7Ey/?p=2', 'https://www.xuetangx.com/training/course/33710117'])('keeps %s', (resourceUrl) => {
    expect(renderToStaticMarkup(createElement(TaskResourceLink, { task: { resourceUrl } as DailyTask }))).toContain('打开学习资源');
    expect(renderToStaticMarkup(createElement(LearningModuleCard, { task: { resourceUrl } as DailyTask, index: 0 }))).toContain('打开学习资源');
  });
});
