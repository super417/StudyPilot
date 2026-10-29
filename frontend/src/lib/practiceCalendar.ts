import type { StarDayItem } from './statisticsApi';

/** 与星图接口一致：北京时间日历日，不受浏览器所在时区影响。 */
export function calendarToday(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function utcDay(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** 按接口的末日展开 30 日，前后补星期占位；占位不代表一次作答。 */
export function practiceCalendarDays(items: StarDayItem[], today: string): Array<StarDayItem | null> {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  const end = utcDay(sorted[sorted.length - 1]?.date ?? today);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 29);
  const byDate = new Map(items.map((item) => [item.date, item]));
  const days: Array<StarDayItem | null> = Array.from({ length: (start.getUTCDay() + 6) % 7 }, () => null);
  for (let index = 0; index < 30; index += 1) {
    const cursor = new Date(start);
    cursor.setUTCDate(start.getUTCDate() + index);
    const date = cursor.toISOString().slice(0, 10);
    days.push(byDate.get(date) ?? { date, answered: 0, accuracy: null, star: 'none' });
  }
  while (days.length % 7) days.push(null);
  return days;
}

export function practiceDayLabel(day: StarDayItem): string {
  return day.answered === 0
    ? `${day.date}：暂无练习证据`
    : `${day.date}：${day.answered} 条练习证据，练习证据得分 ${day.accuracy == null ? '暂不可用' : `${day.accuracy} / 100`}`;
}
