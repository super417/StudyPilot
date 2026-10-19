/**
 * 答辩和离线预览用的 120 天假数据。不写进 data/*.json，也不进数据库。
 * 打开 `#/journey?demo=1` 即可看到不同星级、颜色、未作答、阶段 Boss 和今天节点。
 */

import { addDaysISO } from '@/lib/dates';

import { completionPercent, computeStars, starColor } from './stars';
import type { JourneyDay, JourneyResponse, JourneyTask } from './types';

export const DEMO_TODAY = '2026-10-19';
const DEMO_START = '2026-07-22';
const DEMO_GOAL = '2026-11-18';

interface Spec {
  total: number;
  done: number;
  /** 每题 0–100 的得分；空数组 = 未作答。 */
  scores?: number[];
  checkIn?: boolean;
  minutes?: number;
  tags?: JourneyDay['tags'];
  carried?: number;
}

const PHASES = [
  { id: 'demo-phase-1', name: '阶段一 · 扎根', startDate: '2026-07-22', endDate: '2026-08-31', index: 1 },
  { id: 'demo-phase-2', name: '阶段二 · 数据分析', startDate: '2026-09-01', endDate: '2026-10-16', index: 2 },
  { id: 'demo-phase-3', name: '阶段三 · 图表表达', startDate: '2026-10-17', endDate: '2026-11-18', index: 3 },
];

/**
 * 今天附近手写，打开地图就能看到：
 * 灰星未作答、两星冷色、阶段 Boss、两天全清、今天三星、未来花苞。
 */
const SCRIPTED: Record<string, Spec> = {
  '2026-10-13': { total: 4, done: 3, scores: [100, 50, 0], checkIn: true, minutes: 50 },
  '2026-10-14': { total: 4, done: 3, scores: [50, 100, 50], checkIn: false, minutes: 0 },
  '2026-10-15': { total: 4, done: 0, scores: [], checkIn: true, minutes: 20 },
  '2026-10-16': { total: 5, done: 2, scores: [50, 50], checkIn: true, minutes: 45, tags: ['boss'] },
  '2026-10-17': { total: 4, done: 4, scores: [100, 100, 80, 100], checkIn: true, minutes: 80 },
  '2026-10-18': { total: 4, done: 4, scores: [50, 100, 50, 100], checkIn: true, minutes: 65, tags: ['carried'], carried: 1 },
  '2026-10-19': { total: 5, done: 3, scores: [100, 50, 100, 50], checkIn: true, minutes: 80, tags: ['reinforce'] },
  '2026-10-20': { total: 4, done: 0 },
  '2026-10-21': { total: 0, done: 0 },
  '2026-10-22': { total: 3, done: 0 },
  '2026-10-23': { total: 5, done: 0 },
};

function hash(date: string): number {
  let value = 0;
  for (let i = 0; i < date.length; i += 1) value = (value * 33 + date.charCodeAt(i)) % 997;
  return value;
}

function generated(date: string): Spec {
  const weekend = new Date(`${date}T12:00:00`).getDay() % 6 === 0;
  if (weekend && hash(date) % 3 === 0) return { total: 0, done: 0 };
  const total = 3 + (hash(date) % 3);
  const roll = hash(date) % 10;
  const done = roll < 2 ? 0 : roll < 4 ? Math.max(1, Math.floor(total * 0.3)) : roll < 7 ? Math.ceil(total * 0.6) : total;
  const scores =
    roll % 4 === 0
      ? []
      : Array.from({ length: 3 + (hash(date) % 3) }, (_, index) => [0, 50, 100][(hash(date) + index) % 3]);
  return {
    total,
    done: Math.min(total, done),
    scores,
    checkIn: roll % 5 !== 0,
    minutes: 30 + (hash(date) % 70),
  };
}

function phaseTags(date: string, spec: Spec): JourneyDay['tags'] {
  const tags = new Set(spec.tags ?? []);
  for (const phase of PHASES) {
    if (phase.endDate === date) tags.add('boss');
  }
  return [...tags];
}

function toDay(date: string, today: string, spec: Spec): JourneyDay {
  const scores = spec.scores ?? [];
  const scoreSum = scores.reduce((sum, score) => sum + score, 0);
  const future = date > today;
  const empty = !future && spec.total === 0;
  const state = future ? 'future' : empty ? 'empty' : date === today ? 'today' : 'past';
  const show = state === 'past' || state === 'today';
  return {
    date,
    total: spec.total,
    done: show ? spec.done : 0,
    carried: spec.carried ?? 0,
    pending: show ? Math.max(0, spec.total - spec.done - (spec.carried ?? 0)) : spec.total,
    rate: show ? completionPercent(spec.total, spec.done) : null,
    stars: show ? computeStars(spec.total, spec.done) : null,
    accuracy: show && scores.length > 0 ? Math.round(scoreSum / scores.length) : null,
    starColor: show ? starColor(scoreSum, scores.length) : null,
    hasCheckIn: Boolean(spec.checkIn) && !future,
    minutes: future ? 0 : spec.minutes ?? 0,
    tags: phaseTags(date, spec),
    state,
    loaded: true,
  };
}

export function buildJourneyDemo(today = DEMO_TODAY): JourneyResponse {
  const days: JourneyDay[] = [];
  for (let cursor = DEMO_START; cursor <= DEMO_GOAL; cursor = addDaysISO(cursor, 1)) {
    const spec = cursor > today ? { total: hash(cursor) % 4 === 0 ? 0 : 2 + (hash(cursor) % 4), done: 0 } : (SCRIPTED[cursor] ?? generated(cursor));
    days.push(toDay(cursor, today, spec));
  }
  const weekday = new Date(`${today}T12:00:00`).getDay();
  const monday = addDaysISO(today, weekday === 0 ? -6 : 1 - weekday);
  const sumStars = (start: string, end: string) =>
    days
      .filter((day) => day.date >= start && day.date <= end)
      .reduce((sum, day) => sum + (day.stars ?? 0), 0);
  const checkIns = new Set(days.filter((day) => day.hasCheckIn).map((day) => day.date));
  let streak = 0;
  for (let cursor = today; checkIns.has(cursor); cursor = addDaysISO(cursor, -1)) streak += 1;
  let best = 0;
  let run = 0;
  let previous = '';
  for (const day of [...checkIns].sort()) {
    run = previous && addDaysISO(previous, 1) === day ? run + 1 : 1;
    if (run > best) best = run;
    previous = day;
  }
  let fullClear = 0;
  for (let cursor = days.some((day) => day.date === today && day.rate === 100) ? today : addDaysISO(today, -1); ; cursor = addDaysISO(cursor, -1)) {
    const day = days.find((item) => item.date === cursor);
    if (!day) break;
    if (day.total === 0) continue;
    if (day.rate !== 100) break;
    fullClear += 1;
  }
  return {
    status: 'ok',
    plan: {
      id: 'demo-plan',
      goalName: '把数据讲清楚',
      startDate: DEMO_START,
      goalDate: DEMO_GOAL,
    },
    phases: PHASES,
    today,
    days,
    summary: {
      streakDays: streak,
      bestStreak: best,
      fullClearStreak: fullClear,
      weekStars: sumStars(monday, today),
      lastWeekSameSpanStars: sumStars(addDaysISO(monday, -7), addDaysISO(today, -7)),
    },
  };
}

const TASK_LIBRARY = [
  '看完一节课并写下三个要点',
  '用自己的话复述今天的概念',
  '做一组练习并标出拿不准的题',
  '把错题原因写成一句话',
  '整理一张可以回看的小抄',
];

export function demoTasks(date: string): JourneyTask[] {
  const day = buildJourneyDemo().days.find((item) => item.date === date);
  if (!day || day.total === 0) return [];
  return Array.from({ length: Math.min(5, day.total) }, (_, index) => {
    let status: JourneyTask['status'] = 'pending';
    if (index < day.done) status = 'done';
    else if (day.tags.includes('carried') && index === day.done) status = 'carried';
    return {
      id: `demo-${date}-${index}`,
      description: TASK_LIBRARY[index % TASK_LIBRARY.length],
      status,
    };
  });
}

export function demoCheer(date: string, scope: 'week' | 'day'): { ruleId: string; text: string; facts: Record<string, number | string> } {
  if (scope === 'day') {
    if (date === '2026-10-14') {
      return {
        ruleId: 'day',
        text: '10-14 这天没有完成任务。之后 4 天你都接上了。',
        facts: { done: 0, total: 4, recoveredDays: 4 },
      };
    }
    if (date === '2026-10-16') {
      return {
        ruleId: 'day',
        text: '10-16 全清 4/4，正确率 95%，点亮 4 颗星。',
        facts: { done: 4, total: 4, accuracy: 95, stars: 4 },
      };
    }
    const day = buildJourneyDemo().days.find((item) => item.date === date);
    return {
      ruleId: 'day',
      text: `${date.slice(5)} 完成 ${day?.done ?? 0}/${day?.total ?? 0}。`,
      facts: { done: day?.done ?? 0, total: day?.total ?? 0 },
    };
  }
  return {
    ruleId: 'R1',
    text: '已经连续 2 天把任务全部清空了，藤上挂了 2 个熟透的果实。',
    facts: { k: 2 },
  };
}
