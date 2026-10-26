import { describe, expect, it } from 'vitest';
import { validatePolishedSkills, type ResumeAbility } from '../resumePolish';

const source: ResumeAbility[] = [{
  skill: '数据处理', phase: '第 2 阶段：数据处理', evidenceCount: 5,
  masteryPercent: 75, description: '已有作答证据支持本阶段的学习表现。',
}];

describe('resume polish protection', () => {
  it('accepts description-only changes', () => {
    const result = validatePolishedSkills(source, [{ ...source[0], description: '作答记录显示已有学习表现。' }]);
    expect(result[0].description).toBe('作答记录显示已有学习表现。');
    expect(result[0].evidenceCount).toBe(5);
  });

  it.each(['skill', 'phase', 'evidenceCount', 'masteryPercent'] as const)('rejects changed %s', (field) => {
    expect(() => validatePolishedSkills(source, [{ ...source[0], [field]: 'tampered' }])).toThrow();
  });

  it('rejects added numeric claims in description', () => {
    expect(() => validatePolishedSkills(source, [{ ...source[0], description: '完成 100 个项目。' }])).toThrow();
  });
});
