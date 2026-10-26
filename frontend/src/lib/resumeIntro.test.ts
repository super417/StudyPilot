import { describe, expect, it } from 'vitest';
import type { ResumeAbility } from './resumePolish';
import { buildResumeHeroSummary } from './resumeIntro';

function ability(skill: string, evidenceCount: number, masteryPercent: number | null): ResumeAbility {
  return { skill, phase: '第 1 阶段', evidenceCount, masteryPercent, description: '' };
}

describe('buildResumeHeroSummary', () => {
  it('uses only evidence-backed abilities that meet the verified threshold', () => {
    expect(buildResumeHeroSummary([
      ability('Python 数据处理', 5, 80),
      ability('未作答阶段', 0, 90),
      ability('待验证阶段', 3, 59),
      ability('金融报表分析', 2, 60),
    ])).toBe('已验证能力：Python 数据处理、金融报表分析');
  });

  it('shows an honest empty state without asking for manual profile text', () => {
    expect(buildResumeHeroSummary([])).toBe('暂无已验证能力，练习记录更新后自动显示');
    expect(buildResumeHeroSummary([ability('未作答阶段', 0, 75)])).toBe('暂无已验证能力，练习记录更新后自动显示');
  });

  it('changes the summary when new verified evidence arrives', () => {
    const first = [ability('Python 数据处理', 2, 70)];
    const updated = [...first, ability('金融报表分析', 4, 85)];
    expect(buildResumeHeroSummary(first)).toBe('已验证能力：Python 数据处理');
    expect(buildResumeHeroSummary(updated)).toBe('已验证能力：Python 数据处理、金融报表分析');
  });
});
