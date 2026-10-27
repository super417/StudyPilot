import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import StatisticsDiagnosis, { DiagnosisContent } from '@/components/StatisticsDiagnosis';

describe('学习诊断报告', () => {
  it('保留生成入口、加载状态和卡片视觉', () => {
    const html = renderToStaticMarkup(createElement(StatisticsDiagnosis));
    expect(html).toContain('基于你的刷题数据，AI 将为你生成个性化学习建议');
    expect(html).toContain('生成诊断报告');
    expect(html).toContain('加载诊断报告');
    expect(html).toContain('group-hover:rotate-12');
    expect(html).toContain('disabled');
  });

  it('展示生成时间、证据范围、事实与建议，安全渲染模型内容', () => {
    const html = renderToStaticMarkup(
      createElement(DiagnosisContent, {
        report: {
          id: 'report',
          generatedAt: '2026-10-27T00:00:00Z',
          content: '## 下一步建议\n复习边界条件。<script>alert(1)</script>',
          evidence: {
            totalAnswered: 120,
            sampleCount: 100,
            rangeStart: '2026-10-01T00:00:00Z',
            rangeEnd: '2026-10-26T00:00:00Z',
            distribution: { correct: 80, partial: 20, wrong: 20 },
          },
        },
      }),
    );
    expect(html).toContain('诊断报告');
    expect(html).toContain('生成时间');
    expect(html).toContain('数据范围');
    expect(html).toContain('120');
    expect(html).toContain('100');
    expect(html).toContain('不会自动调整学习计划');
    expect(html).toContain('复习边界条件');
    expect(html).not.toContain('<script>');
  });
});
