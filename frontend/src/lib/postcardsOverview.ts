import type { DailyTask, Metrics, Plan, WeeklyReview } from '@/mocks/types';
import type { LearningInsight } from './overviewInsights';

export type OverviewAction = 'start' | 'goal' | 'plan' | 'tasks' | 'checkin' | 'roadmap' | 'mastery' | 'weekly' | 'mistakes' | 'backlog' | 'profile';
export interface PostcardsOverview {
  ready: boolean;
  error: string | null;
  plan: Plan | null;
  metrics: Metrics | null;
  tasks: DailyTask[];
  review: WeeklyReview | null;
  insights: LearningInsight[];
  pendingMistakeCount: number;
  dueMistakeCount: number;
  unavailable: string[];
}

export function buildPostcardsOverview(data: PostcardsOverview) {
  const { plan, metrics, tasks, review, ready } = data;
  const pending = tasks.filter((task) => task.status === 'pending');
  const done = tasks.filter((task) => task.status === 'done');
  const evidence = (review?.masteryDetail ?? []).reduce((sum, item) => sum + (item.evidenceCount ?? 0), 0);
  const known = (name: string) => ready && !data.unavailable.includes(name);
  const taskValue = !known('tasks') ? '—' : `${pending.length}`;
  const masteryValue = review && evidence > 0 ? `${review.masteryAvg}%` : '—';
  const mistakeValue = known('mistakes') ? `${data.pendingMistakeCount}` : '—';
  const phase = metrics ? `${metrics.phaseProgress.completed}/${metrics.phaseProgress.total}` : '—';
  const note = data.unavailable.includes('review') ? '最近周报暂时无法读取，请稍后重试。'
    : review
    ? `最近周报 ${review.weekStart} 至 ${review.weekEnd}：打卡 ${review.totalMinutes} 分钟，任务完成率 ${review.completionRate}%。`
    : '还没有学习周报。积累真实练习与打卡记录后，可以到数据统计查看复盘。';
  return {
    eyebrow: !ready ? '正在读取学习记录' : plan ? `当前目标 · ${plan.goalDate}` : '从一个学习目标开始',
    description: plan ? plan.goalName : data.error ? '学习记录暂时未能加载，请稍后重试。' : '提交学习内容和完成标准，建立属于自己的阶段路线。',
    highlight: plan?.completionCriterion ? `完成标准：${plan.completionCriterion}` : plan?.currentLevel || '先确认今天的时间和任务量，再按自己的节奏开始。',
    stats: [
      [metrics ? `${metrics.remainingDays}` : '—', '目标剩余天数'],
      [metrics ? `${metrics.totalMinutes}` : '—', '累计打卡分钟'],
      [metrics ? `${metrics.streakDays}` : '—', '连续打卡天数'],
      [phase, '已完成 / 全部阶段'],
    ],
    note,
    plans: [
      { name: '今日安排', monthly: taskValue, annual: review ? `${review.completionRate}%` : '—', suffix: '项待完成', annualSuffix: '周完成率', color: 'lime', action: 'start' as const, cta: '开始今天的学习', note: !known('tasks') ? '今日任务暂未就绪' : `${done.length} 项已完成 · ${metrics?.todayStatus ?? '未反馈'}`, features: [
        known('tasks') ? `今天共安排 ${tasks.length} 项任务，已完成 ${done.length} 项，还有 ${pending.length} 项待完成。` : '正在读取今日任务；读取失败时可以重试，不会把缺失记录算成零项。',
        pending[0] ? `接下来：${pending[0].description}` : known('tasks') && tasks.length ? '今天的已安排任务已经完成，可以选择一个轻量复习。' : '尚无今日任务时，可先选一个小练习，或到路线图查看安排。',
        '开始前先确认今天可用的时间，再选择这次实际要做的任务。',
        '默认只选一项；状态充足时，可以在确认窗口里选择更多。',
        plan?.dailyMinutes ? `原规划每天可用 ${plan.dailyMinutes} 分钟；今天可以按实际情况少做一些。` : '不用勉强凑满固定时长，先选择今天可以承担的学习量。',
        '本次选择只用于这次学习，不会直接改动已保存的阶段路线。',
        '学习后可以勾选任务状态；任务完成与打卡记录分别保存。',
        '打卡填写实际学习分钟、主观难度、精力状态和自己的备注。',
        data.insights[1]?.body ?? '短时间也可以开始：先复述一个要点，或完成一道小题。',
        '任务勾选、今日打卡和补任务入口，统一收在“查看今日任务”中。',
      ] },
      { name: '知识掌握', monthly: masteryValue, annual: masteryValue, suffix: review && evidence > 0 ? '周报均分' : '暂无证据', annualSuffix: review && evidence > 0 ? '周报均分' : '暂无证据', color: 'coral', action: 'mastery' as const, cta: '查看掌握详情', note: review ? `${review.weekStart} 至 ${review.weekEnd} 的周报` : '从真实练习证据开始', features: [
        review && evidence > 0 ? `最近周报掌握均分 ${review.masteryAvg}%，本周期共 ${evidence} 条掌握度证据。` : '本周期没有可用的掌握度证据，暂不把“未知”显示成 0%。',
        ...(review?.masteryDetail ?? []).slice(0, 3).map((item) => `${item.subject}：${item.percent === null ? '暂无证据' : `${item.percent}%`}。`),
        '掌握度来自练习与反馈证据；看过页面不等于已经掌握。',
        metrics ? `阶段路线已完成 ${phase}，可以继续查看当前阶段的任务。` : '生成学习规划后，这里会同步阶段路线的实际进度。',
        review ? `周报记录了 ${review.totalMinutes} 分钟实际打卡，任务完成率 ${review.completionRate}%。` : '完成练习并留下反馈后，到数据统计生成自己的学习周报。',
        '掌握度、任务完成率和打卡时间分别展示，避免把它们混为一谈。',
        '薄弱处可以回到原题，检查答案、错因和正确理解。',
        data.insights[0]?.body ?? '有输出、有记录，再根据实际反馈决定下一步。',
        '需要调整路线时，先查看差异和约束，再由你决定是否确认。',
        '查看详情可展开各阶段掌握度，完整分析仍在数据统计页面。',
      ].slice(0, 11) },
      { name: '回顾复盘', monthly: mistakeValue, annual: review ? `${review.totalMinutes}` : '—', suffix: '题待复习', annualSuffix: '分钟周打卡', color: 'lilac', action: 'mistakes' as const, cta: '打开我的习题本', note: known('mistakes') ? `${data.dueMistakeCount} 题已到复习时间` : '习题记录暂未就绪', features: [
        known('mistakes') ? `习题本中有 ${data.pendingMistakeCount} 题待复习，其中 ${data.dueMistakeCount} 题已经到期。` : '习题本记录暂时无法读取，请稍后重试。',
        '每道错题保留原题、我的答案、错因和正确理解，方便再次尝试。',
        '已到复习时间的题目优先显示；未到期的题目仍保留原安排。',
        '没有待复习题时，先完成今天选好的任务，不额外堆积任务量。',
        '最近周报可查看打卡投入、任务完成率与各阶段的掌握证据。',
        '周报中的建议供你决定是否采用，不会直接替你修改计划。',
        data.insights[2]?.body ?? '回看今天的实际反馈，再决定下一次的学习安排。',
        plan?.completionCriterion ? `回看目标完成标准：${plan.completionCriterion}` : '设置明确的完成标准，回顾时才有具体的判断依据。',
        '未完成的任务可以生成补救预览，确认前不会改动正式计划。',
        '调整后仍保留原有确认与撤销流程，历史学习记录继续保存。',
        '先完成一个可承担的小闭环，再决定要不要继续下一项。',
      ] },
    ],
  };
}
