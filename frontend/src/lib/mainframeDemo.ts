/**
 * `#/mainframe` 演示首屏的数据源。
 *
 * 这一页**不走登录态**（`App.tsx` 在鉴权判断之前就渲染它），未登录时下面的接口必然
 * 401。完成率、累计分钟、连续天数和阶段进度都没有兜底数字：接口失败或没有周报时
 * 显示「暂无数据」。引用没有兜底，未登录就是空列表。
 */
import { listDocuments } from './documentsApi';
import { fetchOverviewMetrics } from './studyApi';
import { fetchLatestWeeklyReview } from './weeklyReviewsApi';

export interface DemoSnapshot {
  /** 本周复盘完成率（0-100）。没有周报时为 null，不能显示成编造的百分数。 */
  completionRate: number | null;
  /** 本周累计学习分钟数。没有周报时为 null。 */
  totalMinutes: number | null;
  /** 连续打卡天数。没有周报时为 null。 */
  streakDays: number | null;
  /** 阶段进度：已完成阶段数。没有数据时为 null。 */
  phaseCompleted: number | null;
  /** 阶段进度：阶段总数。没有数据时为 null。 */
  phaseTotal: number | null;
  /** true = 字段来自真实接口 */
  live: boolean;
}

/** 演示页能确认的资料来源：只有用户上传过的文件名。 */
export interface DemoCitation {
  filename: string;
}

/**
 * 接口不可用或没有周报时的空状态。全部数字字段为 null，界面写「暂无数据」。
 */
export const FALLBACK_SNAPSHOT: DemoSnapshot = {
  completionRate: null,
  totalMinutes: null,
  streakDays: null,
  phaseCompleted: null,
  phaseTotal: null,
  live: false,
};

function todayISO(): string {
  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * 后端 `completion_rate` 是 **0-100 的整数**（`weekly_review_service.completion_rate`
 * 返回 `round(done/total*100)`，且 `entities.py` 上有 `BETWEEN 0 AND 100` 约束），
 * 所以直接取整即可。
 *
 * 曾经这里写过「≤1 就当比例 ×100」的兼容分支 —— 那是错的：完成率恰好 1% 时
 * 会被放大成 100%，在演示页上直接变成一个假数字。
 */
function toPercent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(Math.min(value, 100));
}

/**
 * 分钟转小时，保留一位小数。没有分钟数时返回 null，不能变成 `0.0`。
 */
export function formatHours(minutes: number | null): string | null {
  if (minutes == null) return null;
  return (minutes / 60).toFixed(1);
}

export async function loadDemoSnapshot(): Promise<DemoSnapshot> {
  try {
    const [metrics, weekly] = await Promise.all([
      fetchOverviewMetrics(todayISO()),
      fetchLatestWeeklyReview(),
    ]);
    const review = weekly.review;
    if (!review) return FALLBACK_SNAPSHOT;
    return {
      completionRate: toPercent(review.completionRate),
      totalMinutes: review.totalMinutes,
      streakDays: review.streakDays,
      phaseCompleted: metrics.phaseProgress.completed,
      phaseTotal: metrics.phaseProgress.total,
      live: true,
    };
  } catch {
    return FALLBACK_SNAPSHOT;
  }
}

export async function loadDemoCitations(): Promise<DemoCitation[]> {
  try {
    const res = await listDocuments();
    return res.documents
      .filter((doc) => doc.ready)
      .slice(0, 3)
      .map((doc) => ({ filename: doc.filename }));
  } catch {
    return [];
  }
}
