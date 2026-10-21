import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import TaskResourceLink from '@/components/TaskResourceLink';
import { LearningModuleCard } from '@/pages/PhaseDetailPage';
import type { DailyTask } from '@/mocks/types';

const task: DailyTask = {
  id: 'task-1',
  phaseId: 'phase-1',
  taskDate: '2026-10-21',
  weekLabel: 'W43',
  description: '学习缺失值处理',
  status: 'pending',
  resourceUrl: 'https://www.icourse163.org/course/example',
};

describe('任务卡课程位置', () => {
  it('有命中信息时在链接旁显示章与节', () => {
    const withLocation = {
      ...task,
      chapterTitle: '第 3 章 数据清洗',
      sectionTitle: '3.2 缺失值处理',
    };
    for (const markup of [
      renderToStaticMarkup(createElement(TaskResourceLink, { task: withLocation })),
      renderToStaticMarkup(createElement(LearningModuleCard, { task: withLocation, index: 0 })),
    ]) {
      expect(markup).toContain('第 3 章 数据清洗 · 3.2 缺失值处理');
      expect(markup).toContain('打开学习资源');
      expect(markup).not.toContain('视频');
    }
  });

  it('历史任务无章节字段时只显示链接，不留分隔符', () => {
    for (const markup of [
      renderToStaticMarkup(createElement(TaskResourceLink, { task })),
      renderToStaticMarkup(createElement(LearningModuleCard, { task, index: 0 })),
    ]) {
      expect(markup).toContain('打开学习资源');
      expect(markup).not.toContain('</a><span');
      expect(markup).not.toContain('undefined');
    }
  });
});
