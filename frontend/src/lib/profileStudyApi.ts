/**
 * 个人中心学习进度 / 统计：由真实 metrics、daily-tasks、weekly-reviews 派生。
 * 无对应字段的能力不做假数（课程/笔记接口不存在，由卡片空态处理）。
 */

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
import { listNotes } from '@/lib/notesApi';
import { fetchCourseOverview } from '@/lib/coursesApi';

/** 学习进度概览。 */
export interface StudyProgressOverview {
  /** 总体进度百分比 0-100（阶段完成比） */
  overallPercent: number;
  /** 今日学习时长（分钟）；无单日时长接口时为 0 */
  todayMinutes: number;
  /** 今日三态（真实 metrics） */
  todayStatus?: string;
  /** 本周目标（分钟）；若 weekTaskMode 则为任务总数 */
  weeklyGoalMinutes: number;
  /** 本周已完成（分钟）；若 weekTaskMode 则为已完成任务数 */
  weeklyDoneMinutes: number;
  /** true 时周进度按「任务数」展示，非分钟 */
  weekTaskMode?: boolean;
}

/** 学习统计概览。 */
export interface StudyStatsOverview {
  /** 连续学习天数 */
  streakDays: number;
  /** 本周学习时长（分钟） */
  weeklyMinutes: number;
  /** 完成任务数 */
  completedTasks: number;
  /** 知识点掌握百分比 0-100 */
  masteryPercent: number;
  /** 近 7 日每日学习时长（分钟），用于迷你趋势图 */
  weeklyTrend: number[];
}

/** 课程概览。 */
export interface CoursesOverview {
  /** 在学课程数 */
  activeCount: number;
  /** 最近课程名 */
  recentCourse: string;
  /** 下一个任务描述 */
  nextTask: string;
}

/** 单条笔记。 */
export interface NoteItem {
  id: string;
  /** 笔记标题 */
  title: string;
  /** 所属课程 / 标签 */
  course: string;
  /** 更新时间（相对文案） */
  updatedAt: string;
}

/** 笔记概览。 */
export interface NotesOverview {
  /** 笔记总数 */
  total: number;
  /** 最近 1-3 条笔记 */
  recent: NoteItem[];
}

/** 单条今日待办。 */
export interface TodoItem {
  id: string;
  /** 待办文案 */
  title: string;
  /** 场景标签（考研 / 科研） */
  tag: string;
  /** 是否已完成 */
  done: boolean;
  /** review：点开到期错题，不切换任务状态 */
  kind?: 'task' | 'review';
}

/** 单条最近动态。 */
export interface ActivityItem {
  id: string;
  /** 动态文案 */
  text: string;
  /** 相对时间 */
  at: string;
}

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

/** 课程：在学门数、最近编辑的一门、规划里匹配到的下一条未完成任务。 */
export async function fetchCourses(): Promise<CoursesOverview> {
  const res = await fetchCourseOverview();
  return {
    activeCount: res.activeCount,
    recentCourse: res.recentCourse,
    nextTask: res.nextTask,
  };
}

/** 笔记：GET /api/notes，卡片只展示最近 3 条。 */
export async function fetchNotes(): Promise<NotesOverview> {
  const res = await listNotes();
  const notes = res.notes ?? [];
  return {
    total: notes.length,
    recent: notes.slice(0, 3).map((note) => ({
      id: note.id,
      title: note.title,
      course: note.subject || '未分科目',
      updatedAt: relativeAt(note.updatedAt, '刚刚'),
    })),
  };
}

/** 到期错题插在今日任务前面。0 道则不加。 */
export function withDueReview(tasks: TodoItem[], dueCount: number): TodoItem[] {
  if (dueCount <= 0) return tasks;
  return [
    {
      id: 'mistakes-due',
      title: `复习今天到期的 ${dueCount} 道错题`,
      tag: '错题',
      done: false,
      kind: 'review',
    },
    ...tasks,
  ];
}

/** 今日待办：当天任务，加上今天到期的错题。 */
export async function fetchTodayTodos(): Promise<TodoItem[]> {
  const [res, mistakes] = await Promise.all([
    fetchDailyTasks(todayISO()),
    listMistakes().catch(() => null),
  ]);
  const tasks = (res.tasks ?? []).map((t) => ({
    id: t.id,
    title: t.description,
    tag: t.weekLabel || '今日',
    done: t.status === 'done',
  }));
  return withDueReview(tasks, mistakes?.dueCount ?? 0);
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

  const dueCount = 'dueCount' in mistakesRes ? (mistakesRes.dueCount ?? 0) : 0;
  if (dueCount > 0) {
    items.push({ id: 'mistakes-due', text: `今天有 ${dueCount} 道错题到期该复习`, at: '今天' });
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
