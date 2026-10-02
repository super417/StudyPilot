/**
 * 个人中心学习进度 / 统计：由真实 metrics、daily-tasks、weekly-reviews 派生。
 * 无对应字段的能力不做假数（课程/笔记接口不存在，由卡片空态处理）。
 */

import type {
  StudyProgressOverview,
  StudyStatsOverview,
  CoursesOverview,
  NotesOverview,
  TodoItem,
  ActivityItem,
} from '@/mocks/profileMock';
import { currentWeekDates, todayISO } from '@/lib/dates';
import {
  fetchDailyTasks,
  fetchDailyTasksForDates,
  fetchOverviewMetrics,
} from '@/lib/studyApi';
import { fetchLatestWeeklyReview } from '@/lib/weeklyReviewsApi';
import { listMistakes } from '@/lib/mistakesApi';
import { listDocuments } from '@/lib/documentsApi';
import { fetchLatestPlan } from '@/lib/plansApi';

export type {
  StudyProgressOverview,
  StudyStatsOverview,
  TodoItem,
  ActivityItem,
};

/** 阶段进度环 + 今日三态 + 本周任务完成比。 */
export async function fetchStudyProgress(): Promise<StudyProgressOverview> {
  const today = todayISO();
  const week = currentWeekDates();
  const [overview, tasks] = await Promise.all([
    fetchOverviewMetrics(today),
    fetchDailyTasksForDates(week),
  ]);

  const { completed, total } = overview.phaseProgress;
  const overallPercent =
    total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  const weekDone = tasks.filter((t) => t.status === 'done').length;
  const weekTotal = tasks.length;

  return {
    overallPercent,
    todayMinutes: 0,
    todayStatus: overview.todayStatus,
    weeklyGoalMinutes: weekTotal,
    weeklyDoneMinutes: weekDone,
    weekTaskMode: true,
  };
}

/** 连续打卡、累计/周报时长、本周完成任务、掌握度、近 7 日任务活跃度。 */
export async function fetchStudyStats(): Promise<StudyStatsOverview> {
  const today = todayISO();
  const week = currentWeekDates();
  const [overview, tasks, weekly] = await Promise.all([
    fetchOverviewMetrics(today),
    fetchDailyTasksForDates(week),
    fetchLatestWeeklyReview(),
  ]);

  const weekDone = tasks.filter((t) => t.status === 'done').length;
  const weeklyMinutes =
    weekly.review?.totalMinutes ?? overview.totalMinutes;
  const masteryPercent = weekly.review?.masteryAvg ?? 0;

  const byDate = new Map<string, number>();
  for (const d of week) byDate.set(d, 0);
  for (const t of tasks) {
    byDate.set(t.taskDate, (byDate.get(t.taskDate) ?? 0) + 1);
  }
  const weeklyTrend = week.map((d) => byDate.get(d) ?? 0);

  return {
    streakDays: overview.streakDays,
    weeklyMinutes,
    completedTasks: weekDone,
    masteryPercent,
    weeklyTrend,
  };
}

/** 后端无课程接口：显式空态，禁止 mock 数字。 */
export function fetchCourses(): Promise<CoursesOverview> {
  return Promise.resolve({
    activeCount: 0,
    recentCourse: '',
    nextTask: '',
  });
}

/** 后端无笔记接口：显式空态。 */
export function fetchNotes(): Promise<NotesOverview> {
  return Promise.resolve({
    total: 0,
    recent: [],
  });
}

/** 今日待办：GET /api/daily-tasks?date=today */
export async function fetchTodayTodos(): Promise<TodoItem[]> {
  const res = await fetchDailyTasks(todayISO());
  return (res.tasks ?? []).map((t) => ({
    id: t.id,
    title: t.description,
    tag: t.weekLabel || '今日',
    done: t.status === 'done',
  }));
}

function relativeAt(iso: string | undefined, fallback: string): string {
  if (!iso) return fallback;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return fallback;
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  return iso.slice(0, 10);
}

/**
 * 最近动态：由文档 / 规划 / 错题 / 周报 / 今日状态派生，无独立 activities 表。
 * 全部为空时返回 []（空态），不填假流水。
 */
export async function fetchRecentActivities(): Promise<ActivityItem[]> {
  const today = todayISO();
  const [docsRes, weeklyRes, mistakesRes, planRes, overview] = await Promise.all([
    listDocuments().catch(() => ({ status: 'ok', documents: [] as Awaited<
      ReturnType<typeof listDocuments>
    >['documents'] })),
    fetchLatestWeeklyReview().catch(() => ({
      status: 'ok' as const,
      review: null,
      empty: true,
    })),
    listMistakes().catch(() => ({
      status: 'ok',
      pendingCount: 0,
      mistakes: [] as Awaited<ReturnType<typeof listMistakes>>['mistakes'],
    })),
    fetchLatestPlan().catch(() => ({
      status: 'ok' as const,
      empty: true,
      plan: null,
      phases: [],
    })),
    fetchOverviewMetrics(today).catch(() => null),
  ]);

  const items: ActivityItem[] = [];

  const docs = docsRes.documents ?? [];
  if (docs[0]) {
    items.push({
      id: `doc-${docs[0].docId}`,
      text: `上传资料「${docs[0].filename}」`,
      at: relativeAt(docs[0].uploadedAt, '最近'),
    });
  }

  if (planRes.plan) {
    items.push({
      id: `plan-${planRes.plan.id}`,
      text: `考研规划「${planRes.plan.goalName}」已就绪`,
      at: relativeAt(planRes.plan.updatedAt, '最近'),
    });
  }

  if (mistakesRes.pendingCount > 0) {
    items.push({
      id: 'mistakes-pending',
      text: `错题本待复习 ${mistakesRes.pendingCount} 道`,
      at: '当前',
    });
  } else if (mistakesRes.mistakes[0]) {
    const q = mistakesRes.mistakes[0].question;
    items.push({
      id: `mistake-${mistakesRes.mistakes[0].id}`,
      text: `错题：${q.slice(0, 28)}${q.length > 28 ? '…' : ''}`,
      at: relativeAt(mistakesRes.mistakes[0].createdAt, '最近'),
    });
  }

  if (weeklyRes.review) {
    items.push({
      id: `weekly-${weeklyRes.review.weekStart}`,
      text: `本周复盘已生成（完成率 ${weeklyRes.review.completionRate}%）`,
      at: relativeAt(weeklyRes.review.createdAt, '本周'),
    });
  }

  // 三态取自后端 metrics_service.classify_today：未反馈 / 已安排 / 已完成
  if (overview?.todayStatus === '已完成') {
    items.push({
      id: `checkin-${today}`,
      text: '今日已打卡',
      at: '今天',
    });
  } else if (overview?.todayStatus === '已安排') {
    items.push({
      id: `partial-${today}`,
      text: '今日学习进行中（部分完成）',
      at: '今天',
    });
  }

  return items.slice(0, 6);
}
