import { tasksUntilFourStars } from './stars';
import type { CheerResponse, JourneyDay, JourneyResponse } from './types';

const CAP_TEXT = '今天的夸夸用完啦，去做题吧';

export function cheerCapText(): string {
  return CAP_TEXT;
}

function line(
  ruleId: string,
  text: string,
  facts: Record<string, number | string>,
  suggestRoadmap = false,
): CheerResponse {
  return { ruleId, text, facts, source: 'template', suggestRoadmap };
}

/** 演示模式用的同一套优先级。在线模式走 /api/journey/cheer，不在这里编数。 */
export function localCheer(
  data: JourneyResponse,
  scope: 'week' | 'day',
  date: string | undefined,
  exclude: string[],
): CheerResponse {
  const skipped = new Set(exclude);
  if (scope === 'day') return dayLine(data, date ?? data.today);
  const today = data.days.find((day) => day.date === data.today);
  const ranked = [
    data.summary.fullClearStreak >= 2
      ? line(
          'R1',
          `已经连续 ${data.summary.fullClearStreak} 天把任务全部清空了，藤上挂了 ${data.summary.fullClearStreak} 个熟透的果实。`,
          { k: data.summary.fullClearStreak },
        )
      : null,
    today && today.rate !== null && today.rate >= 60 && today.rate < 80
      ? line(
          'R4',
          `今天完成 ${today.done}/${today.total}，再完成 ${tasksUntilFourStars(today.total, today.done)} 项就能点亮第 4 颗星。`,
          { done: today.done, total: today.total, n: tasksUntilFourStars(today.total, today.done) },
        )
      : null,
    data.summary.streakDays >= 3
      ? line('R6', `连续打卡 ${data.summary.streakDays} 天，最长一次是 ${data.summary.bestStreak} 天。`, {
          s: data.summary.streakDays,
          best: data.summary.bestStreak,
        })
      : null,
    data.summary.weekStars > data.summary.lastWeekSameSpanStars
      ? line(
          'R7',
          `这周已经收集了 ${data.summary.weekStars} 颗星，比上周同期多 ${data.summary.weekStars - data.summary.lastWeekSameSpanStars} 颗。`,
          { w: data.summary.weekStars, d: data.summary.weekStars - data.summary.lastWeekSameSpanStars },
        )
      : null,
  ];
  for (const item of ranked) {
    if (item && !skipped.has(item.ruleId) && !item.text.includes('效率')) return item;
  }
  const index = data.plan ? daysBetween(data.plan.startDate, data.today) : 1;
  const totalDone = data.days
    .filter((day) => day.date <= data.today && day.state !== 'future')
    .reduce((sum, day) => sum + day.done, 0);
  return line('R9', `第 ${index} 天，已经完成 ${totalDone} 项任务，藤长到第 ${index} 节了。`, {
    n: index,
    totalDone,
  });
}

function daysBetween(start: string, end: string): number {
  const from = new Date(`${start}T12:00:00`).getTime();
  const to = new Date(`${end}T12:00:00`).getTime();
  return Math.round((to - from) / 86_400_000) + 1;
}

function dayLine(data: JourneyResponse, date: string): CheerResponse {
  const day = data.days.find((item) => item.date === date);
  const label = date.slice(5);
  if (!day || day.state === 'future') {
    const total = day?.total ?? 0;
    const text = total > 0 ? `${label} 计划了 ${total} 项，还没到这一天。` : `${label} 还没有安排任务。`;
    return line('day', text, { total });
  }
  if (day.total <= 0) return line('day', `${label} 没有安排任务，不计入完成率。`, { total: 0 });
  if (day.done <= 0) {
    const later = data.days.filter((item) => item.date > date && item.date <= data.today && item.total > 0 && item.state !== 'future');
    const recovered = later.length > 0 && later.every((item) => item.done >= 1) ? later.length : 0;
    const text = recovered
      ? `${label} 这天没有完成任务。之后 ${recovered} 天你都接上了。`
      : `${label} 这天没有完成任务。可以从 Roadmap 查看剩下的任务，本页不会改动计划。`;
    return line('day', text, { done: 0, total: day.total, recoveredDays: recovered }, true);
  }
  if (day.rate === 100) {
    const accuracy = day.accuracy === null ? '' : `，正确率 ${day.accuracy}%`;
    return line('day', `${label} 全清 ${day.done}/${day.total}${accuracy}，点亮 ${day.stars} 颗星。`, {
      done: day.done,
      total: day.total,
      stars: day.stars ?? 0,
    });
  }
  const accuracy = day.accuracy === null ? '还没作答' : `正确率 ${day.accuracy}%`;
  return line('day', `${label} 完成 ${day.done}/${day.total}，${accuracy}，点亮 ${day.stars} 颗星。`, {
    done: day.done,
    total: day.total,
    stars: day.stars ?? 0,
  });
}

export function dayFacts(day: JourneyDay | undefined): string {
  if (!day) return '';
  if (day.accuracy === null) return '这天还没作答';
  return `正确率 ${day.accuracy}%`;
}
