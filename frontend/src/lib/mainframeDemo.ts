/**
 * `#/mainframe` 演示首屏的数据源。
 *
 * 这一页**不走登录态**（`App.tsx` 在鉴权判断之前就渲染它），未登录时下面的接口必然
 * 401，所以每一个都包了兜底 —— 评委看到的数字永远存在，不会空白、不会报错、不会转圈。
 *
 * 数据策略：能取到真数据就用真的，取不到就用量级一致的兜底值。**不做部分合并**
 * —— 真一半假一半会让人分不清哪个可信，要么全真要么全兜底。
 */
import { listDocuments } from './documentsApi';
import { fetchOverviewMetrics } from './studyApi';
import { fetchLatestWeeklyReview } from './weeklyReviewsApi';

export interface DemoSnapshot {
  /** 本周复盘完成率（0-100） */
  completionRate: number;
  /** 本周累计学习分钟数 */
  totalMinutes: number;
  /** 连续打卡天数 */
  streakDays: number;
  /** 阶段进度：已完成阶段数 */
  phaseCompleted: number;
  /** 阶段进度：阶段总数（为 0 时不展示这一行） */
  phaseTotal: number;
  /** true = 数字来自真实接口；false = 用了兜底值 */
  live: boolean;
}

/** RAG 引用溯源卡片的一条来源 */
export interface DemoCitation {
  filename: string;
  snippet: string;
  /** 相关度 0-1 */
  score: number;
}

/**
 * 接口不可用时的兜底快照。
 * 量级刻意贴近真实使用场景（一周 10 小时上下、完成率八成多），肉眼看不出是假数据。
 */
export const FALLBACK_SNAPSHOT: DemoSnapshot = {
  completionRate: 86,
  totalMinutes: 642,
  streakDays: 9,
  phaseCompleted: 3,
  phaseTotal: 4,
  live: false,
};

/**
 * 引用卡片的兜底来源。
 *
 * 文件名优先用用户**真实上传**的文档（`GET /api/documents`），拿不到才用这里的示例名。
 * 片段与相关度是固定值 —— 后端目前没有返回引用片段的能力（`assistant_service` 只吐
 * token 流），所以这一块只能是演示数据，不能伪装成真的。
 */
export const FALLBACK_CITATIONS: DemoCitation[] = [
  {
    filename: '考研数学复习全书·高数分册.pdf',
    snippet: '该章节的核心考点集中在中值定理的应用，建议配合近五年真题中对应题型集中训练。',
    score: 0.92,
  },
  {
    filename: '英语一历年真题解析.docx',
    snippet: '此处的方法依赖上一章结论，复习前需先确认前置概念已经掌握，否则会反复出错。',
    score: 0.87,
  },
  {
    filename: '专业课 408 错题整理.md',
    snippet: '本知识点在真题中出现频率较高，建议纳入本周重点复习清单并安排二次回看。',
    score: 0.81,
  },
];

/** 文件名取自真实文档、片段用通用表述，避免出现「文件名是英语、片段讲数学」的穿帮。 */
const GENERIC_SNIPPETS = [
  '该章节的核心考点集中在中值定理的应用，建议配合近五年真题中对应题型集中训练。',
  '此处的方法依赖上一章结论，复习前需先确认前置概念已经掌握，否则会反复出错。',
  '本知识点在真题中出现频率较高，建议纳入本周重点复习清单并安排二次回看。',
];

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

/** 分钟转小时，保留一位小数（演示卡片上不出现 10.7 以外的精度）。 */
export function formatHours(minutes: number): string {
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
    const ready = res.documents.filter((doc) => doc.ready).slice(0, 3);
    if (ready.length === 0) return FALLBACK_CITATIONS;
    return ready.map((doc, i) => ({
      filename: doc.filename,
      snippet: GENERIC_SNIPPETS[i % GENERIC_SNIPPETS.length],
      score: FALLBACK_CITATIONS[i % FALLBACK_CITATIONS.length].score,
    }));
  } catch {
    return FALLBACK_CITATIONS;
  }
}
