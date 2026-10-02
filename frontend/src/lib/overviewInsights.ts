import type { Metrics, DailyTask, MasteryDetailItem, Mistake, WeeklyReview } from '@/mocks/types';

export interface LearningInsight {
  index: string;
  kind: string;
  title: string;
  body: string;
  evidence: string;
}

/** 从真实指标推导「学习模式」三条洞察（不编造规划文档证据）。 */
export function buildLearningInsights(
  metrics: Metrics | null,
  todayTasks: DailyTask[],
): LearningInsight[] {
  const todayStatus = metrics?.todayStatus ?? '未反馈';
  const streak = metrics?.streakDays ?? 0;
  const doneTasks = todayTasks.filter((t) => t.status === 'done').length;
  const totalTasks = todayTasks.length;

  const hardRule: LearningInsight = {
    index: '01',
    kind: '硬规则',
    title: '只看不算完成',
    body:
      totalTasks > 0
        ? `今日已安排 ${totalTasks} 项任务，完成 ${doneTasks} 项。有输出、有打卡才算完成；仅浏览不算。`
        : '今日尚无任务。提交规划并生成每日任务后，完成以打卡与任务勾选为准，而不是“看过”。',
    evidence: `证据: 今日任务 ${doneTasks}/${totalTasks} · 状态「${todayStatus}」`,
  };

  const restart: LearningInsight = {
    index: '02',
    kind: '重启方式',
    title: streak <= 1 ? '中断后先做 2 分钟' : `连续 ${streak} 天，保持最小启动`,
    body:
      streak <= 1
        ? '连续打卡偏弱时，用 2 分钟复述或一道小题重建手感，比硬追进度更稳。'
        : `当前连续打卡 ${streak} 天。若中断，用最短任务（复述要点 / 一题）重启，避免一次补完。`,
    evidence: `证据: streakDays=${streak}`,
  };

  const observe: LearningInsight = {
    index: '03',
    kind: '待观察',
    title: `今日反馈：${todayStatus}`,
    body:
      todayStatus === '已完成'
        ? '今日已打卡完成。隔日可回看错题与周报，确认是否真正掌握。'
        : todayStatus === '已安排'
          ? '任务已安排但尚未打卡。完成后回来反馈，掌握度与连续天数才会更新。'
          : '尚无今日反馈。「未反馈」不计入完成，打卡后总览与周报才会刷新。',
    evidence: `证据: metrics.todayStatus=${todayStatus}`,
  };

  return [hardRule, restart, observe];
}

export function isoWeekLabel(date = new Date()): string {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `W${String(week).padStart(2, '0')}`;
}

export function buildSelfNote(input: {
  metrics: Metrics | null;
  review: WeeklyReview | null;
  todayTasks: DailyTask[];
}): { headline: string; recentLabel: string; nextStep: string } {
  const { metrics, review, todayTasks } = input;
  const pending = todayTasks.find((t) => t.status === 'pending');
  const phase = metrics?.phaseProgress;
  const phaseText =
    phase && phase.total > 0
      ? `阶段进度 ${phase.completed}/${phase.total}`
      : '规划阶段尚未就绪';

  const headline = review
    ? `本周复盘已生成（${review.weekStart} ~ ${review.weekEnd}）：投入 ${review.totalMinutes} 分钟，完成率 ${review.completionRate}%，掌握均分 ${review.masteryAvg}%。目标是把「看→写理解→做题」跑通，不盲目追进度。`
    : metrics
      ? `当前${phaseText}，连续打卡 ${metrics.streakDays} 天，累计投入 ${metrics.totalMinutes} 分钟。今日状态「${metrics.todayStatus}」。先稳住每日最小闭环，再谈加速。`
      : '提交考研规划并开始打卡后，这里会根据你的周报与今日状态生成近期自述。';

  const nextStep = pending
    ? `下一步：${pending.description}`
    : phase && phase.total > 0 && phase.completed < phase.total
      ? `下一步：推进剩余 ${phase.total - phase.completed} 个阶段`
      : '下一步：在学习助手中细化今日任务或复习错题';

  return {
    headline,
    recentLabel: review ? '最近周报' : '最近总结',
    nextStep,
  };
}

export type { MasteryDetailItem, Mistake, WeeklyReview };
