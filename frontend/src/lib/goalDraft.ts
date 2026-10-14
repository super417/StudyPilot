const VAGUE_GOAL = /^(?:学习|复习|不知道|随便|看看|先这样|没有|无)[。.!！]?$/;
const CANONICAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export interface GoalDraftInput {
  goalName: string;
  goalDate: string;
  currentLevel: string;
  dailyMinutes: string;
  completionCriterion: string;
  today: string;
}

export interface GoalDraftValue {
  goalName: string;
  goalDate: string;
  currentLevel: string;
  dailyMinutes: number;
  completionCriterion: string;
}

export function completionCriterionLabel(value: string | null | undefined): string {
  const text = value?.trim();
  return text ? text : '未设置';
}

export function validateGoalDraft(
  input: GoalDraftInput,
): { ok: true; value: GoalDraftValue } | { ok: false; hint: string } {
  const goalName = input.goalName.trim();
  const currentLevel = input.currentLevel.trim();
  const completionCriterion = input.completionCriterion.trim();
  const goalDate = input.goalDate.trim();
  const minutesText = input.dailyMinutes.trim();

  if (!goalName || VAGUE_GOAL.test(goalName)) {
    return { ok: false, hint: '请写明要学的内容，不要只写「学习」或「复习」。' };
  }
  if (!CANONICAL_DATE.test(goalDate) || !isRealDate(goalDate)) {
    return { ok: false, hint: '期限必须是有效的 YYYY-MM-DD。' };
  }
  if (goalDate < input.today) {
    return { ok: false, hint: '期限不能早于拟开始日。' };
  }
  if (!/^[1-9]\d*$/.test(minutesText)) {
    return { ok: false, hint: '每日分钟必须是大于 0 的整数。' };
  }
  if (!currentLevel) {
    return { ok: false, hint: '请填写当前基础。' };
  }
  if (!completionCriterion || VAGUE_GOAL.test(completionCriterion)) {
    return { ok: false, hint: '请写下完成标准。这是你确认的范围或产出，不是掌握度。' };
  }
  return {
    ok: true,
    value: {
      goalName,
      goalDate,
      currentLevel,
      dailyMinutes: Number(minutesText),
      completionCriterion,
    },
  };
}
