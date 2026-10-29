import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PracticeCalendar from '../PracticeCalendar';
import { fetchPracticeDay } from '@/lib/statisticsApi';
import { apiRequest } from '@/lib/httpClient';

vi.mock('@/lib/httpClient', () => ({ apiRequest: vi.fn() }));

describe('紧凑练习日历与按日读取契约', () => {
  it('默认只渲染日期按钮，详情等待点击，不把无数据渲染成零分', () => {
    const html = renderToStaticMarkup(createElement(PracticeCalendar, { items: [], today: '2026-10-29' }));
    expect((html.match(/aria-haspopup="dialog"/g) ?? [])).toHaveLength(30);
    expect(html).not.toContain('<dialog');
    expect(html).not.toContain('practice-calendar-detail');
    expect(html).not.toContain('0分');
    expect(html).toContain('点击日期看得分');
  });
  it('日期格显示真实0分和部分得分，而不是将已作答当无记录', () => {
    const html = renderToStaticMarkup(createElement(PracticeCalendar, { today: '2026-10-29', items: [
      { date: '2026-10-28', answered: 2, accuracy: 0, star: 'gray' },
      { date: '2026-10-29', answered: 1, accuracy: 50, star: 'blue' },
    ] }));
    expect(html).toContain('0分·2条');
    expect(html).toContain('50分·1条');
    expect(html).not.toContain('正确率');
  });
  it('详情请求携带取消信号，读取失败向调用方报告而不伪造空数据', async () => {
    const signal = new AbortController().signal;
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('offline'));
    await expect(fetchPracticeDay('2026-10-29', signal)).rejects.toThrow('offline');
    expect(apiRequest).toHaveBeenCalledWith('/api/statistics/practice-days/2026-10-29', { signal });
  });
});
