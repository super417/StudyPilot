import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import GoalCard from '@/components/GoalCard';
import { completionCriterionLabel, validateGoalDraft } from '@/lib/goalDraft';
import type { Plan } from '@/mocks/types';

const today = '2026-10-11';

function draft(overrides: Partial<Parameters<typeof validateGoalDraft>[0]> = {}) {
  return validateGoalDraft({
    goalName: '线性代数入门',
    goalDate: '2027-06-30',
    currentLevel: '学过矩阵',
    dailyMinutes: '45',
    completionCriterion: '能独立证明秩不等式',
    today,
    ...overrides,
  });
}

describe('goal draft validation', () => {
  it('rejects vague objects, compact dates, past dates, and rounded minutes', () => {
    expect(draft({ goalName: '考研' }).ok).toBe(false);
    expect(draft({ goalDate: '20270630' }).ok).toBe(false);
    expect(draft({ goalDate: '2020-01-01' }).ok).toBe(false);
    expect(draft({ dailyMinutes: '45.4' }).ok).toBe(false);
    expect(draft({ completionCriterion: '' }).ok).toBe(false);
    const accepted = draft();
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.value.dailyMinutes).toBe(45);
  });

  it('shows an empty completion criterion as unset', () => {
    expect(completionCriterionLabel(null)).toBe('未设置');
    expect(completionCriterionLabel('  ')).toBe('未设置');
    const plan: Plan = {
      id: 'p1',
      goalName: '线性代数入门',
      subtitle: '学过矩阵',
      startDate: '2026-10-11',
      goalDate: '2027-06-30',
      currentLevel: '学过矩阵',
      dailyMinutes: 45,
      totalPhases: 2,
      updatedAt: '2026-10-11',
      completionCriterion: null,
    };
    const markup = renderToStaticMarkup(createElement(GoalCard, { plan, today: '2026-10-11' }));
    expect(markup).toContain('完成标准：未设置');
    expect(markup).not.toContain('掌握度');
  });
});
