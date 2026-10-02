/** 本地日历日 YYYY-MM-DD（用户本地时区）。 */
export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 周一为起点的本周 7 天 ISO 日期。 */
export function currentWeekDates(d = new Date()): string[] {
  const day = d.getDay(); // 0 Sun
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(monday);
    x.setDate(monday.getDate() + i);
    return todayISO(x);
  });
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

/** 总览本周日历用：星期标签 + MM-DD + 今天下标。 */
export function currentWeekCalendar(d = new Date()): {
  days: Array<{ weekday: string; date: string }>;
  todayIndex: number;
} {
  const dates = currentWeekDates(d);
  const today = todayISO(d);
  return {
    days: dates.map((iso, i) => ({
      weekday: WEEKDAY_LABELS[i],
      date: iso.slice(5),
    })),
    todayIndex: Math.max(0, dates.indexOf(today)),
  };
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return todayISO(d);
}
