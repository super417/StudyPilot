/**
 * 个人中心「总体进度」口径回归。
 *
 * 口径：总体进度 = 数据统计页「任务完成率」（周报 `completionRate`），两处同源。
 * 没有周报时为 null，不拿阶段完成比或 0 冒充 —— 左栏显示「—」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchOverviewMetrics: vi.fn(),
  fetchDailyTasksForDates: vi.fn(),
  fetchLatestWeeklyReview: vi.fn(),
}));

vi.mock('@/lib/studyApi', () => ({
  fetchOverviewMetrics: mocks.fetchOverviewMetrics,
  fetchDailyTasksForDates: mocks.fetchDailyTasksForDates,
  fetchDailyTasks: vi.fn(),
}));
vi.mock('@/lib/weeklyReviewsApi', () => ({
  fetchLatestWeeklyReview: mocks.fetchLatestWeeklyReview,
}));
vi.mock('@/lib/documentsApi', () => ({ listDocuments: vi.fn() }));
vi.mock('@/lib/mistakesApi', () => ({ listMistakes: vi.fn() }));
vi.mock('@/lib/plansApi', () => ({ fetchLatestPlan: vi.fn() }));
vi.mock('@/lib/notesApi', () => ({ listNotes: vi.fn() }));
vi.mock('@/lib/coursesApi', () => ({ fetchCourseOverview: vi.fn() }));

import { fetchStudyProgress } from '@/lib/profileStudyApi';

const OVERVIEW = {
  status: 'ok',
  totalMinutes: 30,
  streakDays: 0,
  remainingDays: 60,
  phaseProgress: { completed: 0, total: 6 },
  todayStatus: '已完成',
};

const TASKS = [{ taskDate: '2026-11-16', status: 'done' }];

describe('fetchStudyProgress 总体进度口径', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOverviewMetrics.mockResolvedValue(OVERVIEW);
    mocks.fetchDailyTasksForDates.mockResolvedValue(TASKS);
  });

  it('取周报 completionRate，而不是阶段完成比（0/6 仍显示周报的 1%）', async () => {
    mocks.fetchLatestWeeklyReview.mockResolvedValue({
      status: 'ok',
      empty: false,
      review: { weekStart: '2026-11-16', weekEnd: '2026-11-22', completionRate: 1 },
    });

    const res = await fetchStudyProgress();

    expect(res.overallPercent).toBe(1);
  });

  it('没有周报时为 null，不用 0 冒充', async () => {
    mocks.fetchLatestWeeklyReview.mockResolvedValue({
      status: 'ok',
      review: null,
      empty: true,
    });

    const res = await fetchStudyProgress();

    expect(res.overallPercent).toBeNull();
  });
});
