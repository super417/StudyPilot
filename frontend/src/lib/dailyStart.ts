import type { DailyTask } from '@/mocks/types';

export const MICRO_TASKS = ['复述一个已学要点', '完成一道练习并检查答案', '回顾一道错题'] as const;

/** 今日优先，其他任务按原计划日期排列；不改变任何保存记录。 */
export function dailyStartChoices(tasks: DailyTask[], today: string): DailyTask[] {
  return [...new Map(tasks.filter((task) => task.status === 'pending').map((task) => [task.id, task])).values()]
    .sort((a, b) => Number(b.taskDate === today) - Number(a.taskDate === today) || a.taskDate.localeCompare(b.taskDate));
}

/** 仅压缩展示文案，提交给学习助手的任务要求仍保留原文。 */
export function dailyStartSummary(description: string): string {
  const text = description.replace(/\s+/g, ' ').trim();
  const lead = text.split(/[：:，,。；;\n]/)[0]?.trim();
  const summary = lead && lead.length >= 4 ? lead : text;
  return summary.length > 36 ? `${summary.slice(0, 35)}…` : summary || '学习线路任务';
}

export function buildDailyStartPrompt(minutes: number, tasks: DailyTask[], selectedIds: string[], microTask?: string | string[]): string {
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240) throw new Error('请选择 5–240 分钟的可用时间');
  const selected = tasks.filter((task) => task.status === 'pending' && selectedIds.includes(task.id));
  const microChoices = MICRO_TASKS.filter((item) => (Array.isArray(microTask) ? microTask : [microTask]).includes(item));
  if (!selected.length && !microChoices.length) throw new Error('请至少选择一项本次任务');
  const descriptions = selected.length ? selected.map((task, index) => `${index + 1}. ${task.description}`) : microChoices.map((task, index) => `${index + 1}. ${task}（本次自选练习，不是已保存的每日任务）`);
  return `开始今天 ${minutes} 分钟学习。\n我已确认：本次可用 ${minutes} 分钟，只做以下 ${descriptions.length} 项：\n${descriptions.join('\n')}\n请先围绕第一项引导，按这个时间和任务上限量力而行，不额外追加任务。如果时间不足，先做当前项的一小步；想继续时再问我。此次选择不授权修改原规划、延期任务或标记完成，涉及保存变更仍先展示预览并由我确认。`;
}
