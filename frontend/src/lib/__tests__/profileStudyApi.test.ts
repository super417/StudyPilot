/**
 * 个人中心右栏「最近动态」的今日三态派生回归测试。
 *
 * 契约来自后端 `app/services/metrics_service.py` 的 `classify_today()`：
 * todayStatus ∈ {未反馈, 已安排, 已完成}（中文）。
 * 这里曾误写成 checked_in / partial —— 因 `tsconfig.json` 是空壳
 * （`"files": []` + references，`tsc --noEmit` 不编译任何文件），
 * 该错误长期未被发现：类型检查假绿，vitest 也不做类型检查。
 * 断言用中文字面量，避免契约再次漂移。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchOverviewMetrics: vi.fn(),
  listDocuments: vi.fn(),
  fetchLatestWeeklyReview: vi.fn(),
  listMistakes: vi.fn(),
  fetchLatestPlan: vi.fn(),
}));

vi.mock('@/lib/studyApi', () => ({
  fetchDailyTasks: vi.fn(),
  fetchDailyTasksForDates: vi.fn(),
  fetchOverviewMetrics: mocks.fetchOverviewMetrics,
}));
vi.mock('@/lib/documentsApi', () => ({ listDocuments: mocks.listDocuments }));
vi.mock('@/lib/weeklyReviewsApi', () => ({
  fetchLatestWeeklyReview: mocks.fetchLatestWeeklyReview,
}));
vi.mock('@/lib/mistakesApi', () => ({ listMistakes: mocks.listMistakes }));
vi.mock('@/lib/plansApi', () => ({ fetchLatestPlan: mocks.fetchLatestPlan }));

import { fetchRecentActivities } from '@/lib/profileStudyApi';

const EMPTY_DOCS = { status: 'ok', documents: [] };
const EMPTY_WEEKLY = { status: 'ok', review: null, empty: true };
const EMPTY_MISTAKES = { status: 'ok', pendingCount: 0, mistakes: [] };
const EMPTY_PLAN = { status: 'ok', empty: true, plan: null, phases: [] };

function overviewWith(todayStatus: string) {
  return {
    status: 'ok',
    totalMinutes: 0,
    streakDays: 0,
    remainingDays: 100,
    phaseProgress: { completed: 0, total: 0 },
    todayStatus,
  };
}

describe('fetchRecentActivities 今日三态', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listDocuments.mockResolvedValue(EMPTY_DOCS);
    mocks.fetchLatestWeeklyReview.mockResolvedValue(EMPTY_WEEKLY);
    mocks.listMistakes.mockResolvedValue(EMPTY_MISTAKES);
    mocks.fetchLatestPlan.mockResolvedValue(EMPTY_PLAN);
  });

  it('已完成 → 追加「今日已打卡」', async () => {
    mocks.fetchOverviewMetrics.mockResolvedValue(overviewWith('已完成'));

    const texts = (await fetchRecentActivities()).map((i) => i.text);

    expect(texts).toContain('今日已打卡');
  });

  it('已安排 → 追加「今日学习进行中（部分完成）」', async () => {
    mocks.fetchOverviewMetrics.mockResolvedValue(overviewWith('已安排'));

    const texts = (await fetchRecentActivities()).map((i) => i.text);

    expect(texts).toContain('今日学习进行中（部分完成）');
  });

  it('未反馈 → 不追加任何今日状态动态', async () => {
    mocks.fetchOverviewMetrics.mockResolvedValue(overviewWith('未反馈'));

    expect(await fetchRecentActivities()).toHaveLength(0);
  });
});
