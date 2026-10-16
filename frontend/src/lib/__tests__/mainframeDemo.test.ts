import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchOverviewMetrics: vi.fn(),
  fetchLatestWeeklyReview: vi.fn(),
  listDocuments: vi.fn(),
}));

vi.mock('@/lib/studyApi', () => ({
  fetchOverviewMetrics: mocks.fetchOverviewMetrics,
}));
vi.mock('@/lib/weeklyReviewsApi', () => ({
  fetchLatestWeeklyReview: mocks.fetchLatestWeeklyReview,
}));
vi.mock('@/lib/documentsApi', () => ({ listDocuments: mocks.listDocuments }));

import { EMPTY_SNAPSHOT, formatHours, loadDemoSnapshot } from '@/lib/mainframeDemo';

describe('mainframeDemo', () => {
  beforeEach(() => {
    mocks.fetchOverviewMetrics.mockReset();
    mocks.fetchLatestWeeklyReview.mockReset();
    mocks.listDocuments.mockReset();
  });

  it('formatHours 对 null 返回 null，不变成 0.0', () => {
    expect(formatHours(null)).toBeNull();
    expect(formatHours(null)).not.toBe('0.0');
    expect(formatHours(60)).toBe('1.0');
  });

  it('没有周报时全部数字字段为 null，不含 642 或 9', async () => {
    mocks.fetchOverviewMetrics.mockResolvedValue({
      status: 'ok',
      totalMinutes: 0,
      streakDays: 0,
      remainingDays: 1,
      phaseProgress: { completed: 0, total: 0 },
      todayStatus: '未反馈',
    });
    mocks.fetchLatestWeeklyReview.mockResolvedValue({
      status: 'ok',
      review: null,
      empty: true,
    });

    const snapshot = await loadDemoSnapshot();
    expect(snapshot).toEqual(EMPTY_SNAPSHOT);
    expect(snapshot.completionRate).toBeNull();
    expect(snapshot.totalMinutes).toBeNull();
    expect(snapshot.streakDays).toBeNull();
    expect(snapshot.phaseCompleted).toBeNull();
    expect(snapshot.phaseTotal).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain('642');
    expect(JSON.stringify(snapshot)).not.toContain('9');
  });

  it('接口抛错时全部数字字段为 null，不含 642 或 9', async () => {
    mocks.fetchOverviewMetrics.mockRejectedValue(new Error('network'));
    mocks.fetchLatestWeeklyReview.mockRejectedValue(new Error('network'));

    const snapshot = await loadDemoSnapshot();
    expect(snapshot.completionRate).toBeNull();
    expect(snapshot.totalMinutes).toBeNull();
    expect(snapshot.streakDays).toBeNull();
    expect(snapshot.phaseCompleted).toBeNull();
    expect(snapshot.phaseTotal).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain('642');
    expect(JSON.stringify(snapshot)).not.toContain('9');
  });

  it('有真实周报时各字段等于接口值', async () => {
    mocks.fetchOverviewMetrics.mockResolvedValue({
      status: 'ok',
      totalMinutes: 120,
      streakDays: 4,
      remainingDays: 10,
      phaseProgress: { completed: 1, total: 3 },
      todayStatus: '已完成',
    });
    mocks.fetchLatestWeeklyReview.mockResolvedValue({
      status: 'ok',
      review: {
        weekStart: '2026-10-13',
        weekEnd: '2026-10-19',
        totalMinutes: 180,
        streakDays: 5,
        completionRate: 75,
        masteryAvg: 40,
        masteryDetail: [],
        createdAt: '2026-10-15T00:00:00Z',
      },
    });

    const snapshot = await loadDemoSnapshot();
    expect(snapshot).toEqual({
      completionRate: 75,
      totalMinutes: 180,
      streakDays: 5,
      phaseCompleted: 1,
      phaseTotal: 3,
      live: true,
    });
  });
});
