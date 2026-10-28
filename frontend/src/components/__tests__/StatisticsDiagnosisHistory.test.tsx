import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StatisticsDiagnosis, { DiagnosisReportList, filterDiagnosisReports, renameDiagnosisReport } from '@/components/StatisticsDiagnosis';
import { conversationApi } from '@/lib/conversationApi';
import type { DiagnosisReport } from '@/lib/statisticsApi';

const report: DiagnosisReport = {
  id: 'report-1', title: '边界条件复习', generatedAt: '2026-10-27T18:30:00Z', content: '保留正文',
  evidence: { totalAnswered: 2, sampleCount: 2, rangeStart: '2026-10-27T00:00:00Z', rangeEnd: '2026-10-27T18:00:00Z', distribution: { correct: 1, partial: 0, wrong: 1 } },
};

afterEach(() => vi.restoreAllMocks());

describe('诊断报告历史与改名', () => {
  it('使用北京时间日期与报告名字搜索，兼容旧报告', () => {
    expect(filterDiagnosisReports([report], '边界')).toEqual([report]);
    expect(filterDiagnosisReports([report], '2026-10-28')).toEqual([report]);
    expect(filterDiagnosisReports([report], '2026-10-27')).toEqual([]);
    expect(filterDiagnosisReports([{ ...report, title: undefined }], '学习诊断')).toHaveLength(1);
  });

  it('滑块保留原输入与label顺序，文字对应三个报告视图', () => {
    const html = renderToStaticMarkup(createElement(StatisticsDiagnosis));
    expect(html).toMatch(/id="glass-silver"[^>]*checked=""/);
    expect(html).toContain('for="glass-silver">最新报告</label>');
    expect(html).toContain('for="glass-gold">历史报告</label>');
    expect(html).toContain('for="glass-platinum">搜索报告</label>');
    expect(html).toContain('<div class="glass-glider"></div>');
  });

  it('列表提供报告选择和每行独立的改名展开按钮', () => {
    const html = renderToStaticMarkup(createElement(DiagnosisReportList, { reports: [report], onSelect: () => {}, onRename: () => {} }));
    expect(html).toContain('边界条件复习');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('改名：边界条件复习');
  });

  it('改名去除空格后保存，失败不产生本地成功结果，拒绝空白和过长名字', async () => {
    const rename = vi.spyOn(conversationApi, 'rename').mockResolvedValue(undefined);
    expect(await renameDiagnosisReport(report, '  新名字  ')).toEqual({ ...report, title: '新名字' });
    expect(rename).toHaveBeenCalledWith(report.id, '新名字');
    rename.mockClear();
    await expect(renameDiagnosisReport(report, '   ')).rejects.toThrow('1–64');
    await expect(renameDiagnosisReport(report, '长'.repeat(65))).rejects.toThrow('1–64');
    expect(rename).not.toHaveBeenCalled();
    rename.mockRejectedValue(new Error('保存失败'));
    await expect(renameDiagnosisReport(report, '未保存名字')).rejects.toThrow('保存失败');
    expect(report.title).toBe('边界条件复习');
  });
});
