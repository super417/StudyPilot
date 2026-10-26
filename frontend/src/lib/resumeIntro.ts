import type { ResumeAbility } from './resumePolish';

/** 首屏只概括后端已验证、且具有足够作答证据的能力。 */
export function buildResumeHeroSummary(verified: ResumeAbility[]): string {
  const names = [...new Set(verified
    .filter(item => item.evidenceCount > 0 && item.masteryPercent !== null && item.masteryPercent >= 60)
    .map(item => item.skill.trim())
    .filter(Boolean))];
  if (!names.length) return '暂无已验证能力，练习记录更新后自动显示';
  return `已验证能力：${names.slice(0, 2).join('、')}${names.length > 2 ? `等 ${names.length} 项` : ''}`;
}
