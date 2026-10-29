import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PracticeCalendar from '../PracticeCalendar';

describe('近 30 日练习日历展示', () => {
  it('空态保留三十个可打开详情的日期和今日标记，未知不伪装成零分', () => {
    const html = renderToStaticMarkup(createElement(PracticeCalendar, { items: [], today: '2026-10-29' }));
    expect(html.match(/class="practice-calendar-day /g)).toHaveLength(30);
    expect(html).toContain('周一');
    expect(html).toContain('aria-current="date"');
    expect(html).toContain('暂无练习证据');
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(30);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(30);
    expect(html).toContain('2026-10-29：暂无练习证据，今天');
    expect(html).toContain('点击日期看得分');
    expect(html).not.toContain('0分');
    expect(html).not.toContain('得分 0 / 100');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<dialog');
    expect(html).not.toContain('practice-calendar-detail');
  });
  it('日期格区分已知零分和无记录，详情及样本说明留待点击打开', () => {
    const html = renderToStaticMarkup(createElement(PracticeCalendar, {
      items: [{ date: '2026-10-28', answered: 1, accuracy: 0, star: 'gray' }, { date: '2026-10-29', answered: 0, accuracy: null, star: 'none' }],
      today: '2026-10-29', onOpenMistakes: () => undefined,
    }));
    expect(html).toContain('2026-10-28：1 条练习证据，练习证据得分 0 / 100');
    expect(html).toContain('0分·1条');
    expect(html).toContain('2026-10-29：暂无练习证据，今天');
    expect(html).toContain('practice-calendar-day-gray');
    expect(html).toContain('practice-calendar-day-none');
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(30);
    expect(html).not.toContain('aria-expanded="true"');
    expect(html).not.toContain('practice-calendar-detail');
    expect(html).not.toContain('practice-day-summary');
    expect(html).not.toContain('样本较少');
    expect(html).not.toContain('<dialog');
  });
});
