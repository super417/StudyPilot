import type { DailyTask, Metrics, Mistake, Plan, WeeklyReview } from '@/mocks/types';
import type { LearningInsight } from './overviewInsights';

export type OverviewAction = 'start' | 'goal' | 'plan' | 'tasks' | 'checkin' | 'roadmap' | 'mastery' | 'weekly' | 'mistakes' | 'backlog' | 'profile' | 'practice' | 'weakness' | 'retry';
export interface PostcardsOverview {
  ready: boolean; error: string | null; plan: Plan | null; metrics: Metrics | null;
  tasks: DailyTask[]; review: WeeklyReview | null; insights: LearningInsight[];
  pendingMistakeCount: number; dueMistakeCount: number; unavailable: string[];
  featuredMistake?: Mistake | null;
}
export function weakestEvidence(review: WeeklyReview | null) {
  return [...(review?.masteryDetail ?? [])]
    .filter((item) => item.percent !== null && (item.evidenceCount ?? 0) > 0)
    .sort((a, b) => a.percent! - b.percent! || (b.evidenceCount ?? 0) - (a.evidenceCount ?? 0))[0];
}
export function buildPostcardsOverview(data: PostcardsOverview, mode: 'today' | 'weekly' = 'today') {
  const { ready } = data;
  const known = (key: string) => ready && !data.error && !data.unavailable.includes(key);
  const plan = known('plan') ? data.plan : null;
  const metrics = known('metrics') ? data.metrics : null;
  const review = known('review') ? data.review : null;
  const tasks = known('tasks') ? data.tasks.filter((t) => t.status !== 'carried') : [];
  const pending = tasks.filter((t) => t.status === 'pending');
  const done = tasks.filter((t) => t.status === 'done');
  const evidence = (review?.masteryDetail ?? []).reduce((sum, item) => sum + (item.evidenceCount ?? 0), 0);
  const weak = weakestEvidence(review);
  const period = review ? `${review.weekStart} 至 ${review.weekEnd}` : '尚无周报';
  const phase = metrics && known('metrics') ? `${metrics.phaseProgress.completed}/${metrics.phaseProgress.total}` : '—';
  const due = known('mistakes') && data.dueMistakeCount > 0;
  const completed = tasks.length > 0 && tasks.every((t) => t.status === 'done');
  const nextAction: OverviewAction = !known('tasks') ? 'retry' : due ? 'mistakes' : pending.length ? 'start' : completed ? 'tasks' : !plan && known('plan') ? 'plan' : 'practice';
  const next = !known('tasks') ? '读取成功后再决定下一步。'
    : due ? `有 ${data.dueMistakeCount} 题已到复习时间，可先从到期队列选一题。`
    : pending[0] ? `接下来：${pending[0].description}`
    : completed ? '今日安排已完成，可以到此结束；想继续时再自选练习。'
    : !plan && known('plan') ? '先建立学习目标和完成标准，再生成阶段路线。' : '今天暂无待完成任务，可以自选一道小练习。';
  const fact = !known('tasks') ? ready ? '今日任务读取失败，暂时无法判断。' : '正在读取今日任务…'
    : `今天共安排 ${tasks.length} 项任务，已完成 ${done.length} 项，还有 ${pending.length} 项待完成。${pending[0] ? ` 今日待办：${pending[0].description}` : ''}`;
  const note = !known('review') ? ready ? '最近周报读取失败，请重试。' : '正在读取最近周报…' : review
    ? `最近周报 ${period}：打卡 ${review.totalMinutes} 分钟，任务完成率 ${review.completionRate}%。`
    : '还没有学习周报。完成练习并留下记录后，可到数据统计生成复盘。';
  const masteryValue = review && evidence > 0 ? `${review.masteryAvg}%` : '—';
  const weekly = mode === 'weekly';
  const taskFeatures = !known('tasks') ? [fact, next] : [
    fact, next,
    ...(plan?.dailyMinutes ? [`原规划每日可用 ${plan.dailyMinutes} 分钟，这是你设定的时间预算，不是今天实际学习的分钟数。`] : []),
    ...(metrics ? [`今日反馈状态「${metrics.todayStatus}」。任务完成以勾选为准，学习分钟另行填写打卡。`] : []),
    ...(done.length ? [`今天已完成：${done.slice(0, 2).map((task) => task.description).join('；')}${done.length > 2 ? `；另有 ${done.length - 2} 项可在任务记录查看` : ''}。`] : []),
    ...(plan?.completionCriterion ? [`当前目标完成标准：${plan.completionCriterion}。建议把本次任务的具体输出与这个标准对照。`] : []),
    ...(metrics && metrics.phaseProgress.total > 0 ? [`路线已完成 ${phase} 个阶段；这是路线进度，不是今天的练习得分。`] : []),
    completed ? '建议：今天可以收尾，补充实际学习反馈即可；如果自选复习，先重新确认可用时间。'
      : pending.length ? '建议：先只选一项待办；若时间不足，可先做这一项的一小步，继续前再确认。'
      : '建议：没有今日任务时先建立目标，或自选一道练习；自选内容不会自动变成已保存任务。',
  ].slice(0, 8);
  const weeklyTasks = !review ? [note, '打开数据统计生成周报，汇总已有任务和打卡记录。'] : [
    `回顾周期：${period}。以下内容均对应这份周报，不代替今天的任务安排。`,
    `该周期任务完成率 ${review.completionRate}%；完成率来自任务状态，不由打卡分钟推算。`,
    ...review.masteryDetail.filter((item) => item.taskTotal != null && item.taskTotal > 0).slice(0, 2)
      .map((item) => `${item.subject}：周期任务已完成 ${item.taskDone ?? '未提供'}/${item.taskTotal} 项${item.completionRate != null ? `，完成率 ${item.completionRate}%` : ''}。`),
    `同周期打卡 ${review.totalMinutes} 分钟，由你填写；任务完成与打卡分别保存。`,
    `截至周报周期末连续打卡 ${review.streakDays} 天。可打开周报检查未完成项，再决定是否调整后续安排。`,
    `本周期共 ${evidence} 条练习证据。任务完成率与证据得分需要分别回看，不由时长替代。`,
    review.completionRate === 100 ? '建议：本周期任务已全部勾选，可以优先检查具体练习的理解与错因，无须为了完成率追加任务。' : '建议：先在周报中检查未完成的阶段，再决定是否生成补救预览。',
    '若要改动后续路线，先查看任务差异和时间约束，再确认；本次回顾不会自动保存调整。',
  ].slice(0, 8);
  const masteryFeatures = !known('review') ? [note, '读取成功后再根据证据提供建议。'] : !review ? [
    '暂无可用练习证据，暂不估计掌握程度。',
    '先完成一个小练习并留下反馈，再到数据统计生成周报。',
    ...(plan?.completionCriterion ? [`当前目标完成标准：${plan.completionCriterion}；后续可用练习结果对照检查。`] : []),
  ] : [
    `评估周期：${period}；共 ${evidence} 条练习证据。${evidence ? `周报证据得分 ${review.masteryAvg}%，不是今天的实时成绩。` : '本周期暂无可用证据，未知不显示成 0 分。'}`,
    ...review.masteryDetail.slice(0, 2).map((item) => (item.evidenceCount ?? 0) > 0 && item.percent !== null
      ? `${item.subject}：证据得分 ${item.percent}%，样本 ${item.evidenceCount} 条。`
      : `${item.subject}：本周期暂无可用证据，不据此判断是否掌握。`),
    weak ? `建议回看「${weak.subject}」：阶段证据得分 ${weak.percent}%，样本 ${weak.evidenceCount} 条。${(weak.evidenceCount ?? 0) < 5 ? '样本较少，先结合原题确认具体困难。' : '先检查原题答案与错因，再决定是否补练。'}`
      : '下一步可以先完成一个小练习，为下次评估积累真实反馈。',
    `同周期任务完成率 ${review.completionRate}%，与练习证据得分分别统计；勾选任务不直接提高分数。`,
    ...(!weekly && plan?.completionCriterion ? [`对照当前目标：${plan.completionCriterion}。这是现在保存的完成标准，不是周报自动认定已经达标。`] : []),
    '若需要调整路线，先检查证据、任务差异和时间约束，确认后才保存；保留原有撤销入口。',
  ].slice(0, 7);
  const featured = known('mistakes') && data.featuredMistake?.reviewStatus !== 'done' ? data.featuredMistake : null;
  const reviewNext = due ? '下一步先查看到期复习队列，选一题再次作答，再检查原答案与错因。'
    : data.pendingMistakeCount > 0 ? '暂无到期复习；可以在习题本为待安排题目选择复习时间，不自动提前其他题目。'
    : '暂无到期复习；今天可以结束，或按自己的时间选择一项练习。';
  const reviewFeatures = !known('mistakes') ? [
    ready ? '习题记录读取失败，暂时无法判断。' : '正在读取习题记录…',
    '读取成功后再决定是否需要复习。',
  ] : [
    `习题本有 ${data.pendingMistakeCount} 题待安排复习，另有 ${data.dueMistakeCount} 题已到复习时间；两者分开统计。`,
    ...(featured?.question ? [`${featured.due ? '到期队列首题' : featured.reviewStatus === 'scheduled' ? '已安排的复习题' : '待安排的复习题'}：${featured.question}`] : []),
    ...(featured?.reviewStatus === 'scheduled' && !featured.due && featured.nextReviewAt ? [`这题下次复习时间：${featured.nextReviewAt}，目前尚未到期，保留原安排。`] : []),
    ...(featured?.whyWrong?.trim() ? [`这题记录的错因：${featured.whyWrong}`] : []),
    ...(featured?.correctUnderstanding?.trim() ? [`这题记录的正确理解：${featured.correctUnderstanding}`] : []),
    ...(review ? [
      `最近周报周期：${period}；打卡 ${review.totalMinutes} 分钟（用户自报），不是今天自动生成的新结论。`,
      `这份周报任务完成率 ${review.completionRate}%，${evidence > 0 ? `共 ${evidence} 条练习证据、证据得分 ${review.masteryAvg}%` : '暂无可用练习证据'}；完成任务与理解原题分别回看。`,
    ] : []),
    ...(plan?.completionCriterion ? [`当前目标完成标准：${plan.completionCriterion}；复习后可用实际作答对照检查。`] : []),
    ...(weak && !featured?.whyWrong?.trim() ? [`回看重点：「${weak.subject}」阶段得分 ${weak.percent}%，样本 ${weak.evidenceCount} 条。先检查原题错因，再决定是否补练。`] : []),
  ].slice(0, 6).concat(reviewNext);
  const weeklyReviewFeatures = !review ? [note, '留下练习与打卡记录后，到数据统计生成自己的复盘。'] : [
    `最近周报周期：${period}。以下内容均对应这份历史周报。`,
    `周期打卡 ${review.totalMinutes} 分钟（用户自报），截至周报周期末连续打卡 ${review.streakDays} 天。`,
    `周期任务完成率 ${review.completionRate}%；任务勾选与练习判分是独立记录。`,
    evidence ? `本周期共 ${evidence} 条练习证据，证据得分 ${review.masteryAvg}%；请结合原题回看。` : '本周期暂无可用练习证据，未知不当作零分，也不由完成率推断掌握情况。',
    ...review.masteryDetail.slice(0, 1).map((item) => `${item.subject}：${item.percent === null || !(item.evidenceCount ?? 0) ? '暂无可用证据' : `证据得分 ${item.percent}%，样本 ${item.evidenceCount} 条`}。`),
    weak ? `下一步可回看「${weak.subject}」的具体练习与错因，再决定是否补练。` : '下一步可完成一道小练习并保存反馈，为后续评估积累证据。',
    '建议不会自动改动正式计划；调整前先检查证据、差异和约束，确认后才保存，并保留原有撤销入口。',
  ].slice(0, 7);
  return {
    eyebrow: !ready ? '正在读取学习记录' : data.error ? '学习记录读取失败' : !known('plan') ? '学习目标暂时无法读取' : plan ? `当前目标 · ${plan.goalDate}` : '从一个学习目标开始',
    description: plan?.goalName ?? (data.error ? '学习记录暂时未能加载，请重试。' : '提交学习内容和完成标准，建立属于自己的阶段路线。'),
    highlight: plan?.completionCriterion ? `完成标准：${plan.completionCriterion}` : plan?.currentLevel || '先确认今天的时间和任务量，再按自己的节奏开始。',
    stats: [
      [metrics && known('metrics') ? `${metrics.remainingDays}` : '—', '目标剩余天数'],
      [metrics && known('metrics') ? `${metrics.totalMinutes}` : '—', '累计打卡分钟'],
      [metrics && known('metrics') ? `${metrics.streakDays}` : '—', '连续打卡天数'], [phase, '已完成 / 全部阶段'],
    ], note,
    plans: [
      { name: weekly ? '任务回顾' : '今日安排', monthly: known('tasks') ? `${pending.length}` : '—', annual: review ? `${review.completionRate}%` : '—',
        suffix: '项待完成', annualSuffix: '周完成率', color: 'lime',
        action: weekly ? known('review') ? 'weekly' as const : 'retry' as const : nextAction,
        cta: weekly ? '查看周报任务记录' : nextAction === 'retry' ? '重试读取' : nextAction === 'mistakes' ? '查看到期复习' : nextAction === 'start' ? '确认时间并开始' : nextAction === 'tasks' ? '查看今日完成记录' : nextAction === 'plan' ? '建立学习目标' : '选择一个小练习',
        note: weekly ? period : known('tasks') ? `${done.length} 项已完成 · ${metrics?.todayStatus ?? '未反馈'}` : '今日任务暂未就绪',
        features: weekly ? weeklyTasks : taskFeatures,
        reason: weekly ? '依据：最近一次已生成周报。' : !known('tasks') ? '今日任务尚未读取成功，暂不依据旧记录判断下一步。' : due ? '依据：已安排且已到期的复习记录。' : pending.length ? '依据：今日待完成任务。开始前仍需确认本次可用时间。' : '依据：今日任务记录。任务勾选与打卡分别保存。',
        secondaryAction: 'tasks' as const, secondaryLabel: '任务与打卡' },
      { name: '最近评估', monthly: masteryValue, annual: masteryValue, suffix: evidence ? '练习证据得分' : '暂无证据', annualSuffix: evidence ? '练习证据得分' : '暂无证据', color: 'coral',
        action: !known('review') ? 'retry' as const : weak ? 'weakness' as const : 'practice' as const, cta: !known('review') ? '重试读取' : weak ? '回看该阶段证据' : '选择一个小练习', note: period,
        features: masteryFeatures,
        reason: evidence ? `依据：练习结果折算，正确 100、部分掌握 50、错误 0。${(weak?.evidenceCount ?? 0) < 5 ? '阶段样本较少，请结合原题判断。' : '分数不代表完整能力评定。'}` : '没有证据不等于没有掌握。',
        secondaryAction: 'mastery' as const, secondaryLabel: '查看评估明细' },
      { name: weekly ? '学习回顾' : '回顾复盘', monthly: known('mistakes') ? `${data.pendingMistakeCount}` : '—', annual: review ? `${review.totalMinutes}` : '—', suffix: '题待安排', annualSuffix: '分钟周打卡', color: 'lilac',
        action: weekly ? known('review') ? 'weekly' as const : 'retry' as const : !known('mistakes') ? 'retry' as const : 'mistakes' as const,
        cta: weekly ? '打开完整学习周报' : !known('mistakes') ? '重试读取' : due ? '查看到期复习队列' : '打开我的习题本',
        note: weekly ? period : known('mistakes') ? `${data.dueMistakeCount} 题已到复习时间` : '习题记录暂未就绪',
        features: weekly ? weeklyReviewFeatures : reviewFeatures,
        reason: weekly ? '依据：指定周期的打卡与任务记录；建议不会自动修改计划。' : '依据：错题复习状态与到期时间，未到期题目不会自动提前。',
        secondaryAction: 'weekly' as const, secondaryLabel: '查看最近周报' },
    ],
  };
}
