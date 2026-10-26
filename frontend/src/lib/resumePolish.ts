export interface ResumeAbility {
  skill: string;
  phase: string | null;
  evidenceCount: number;
  masteryPercent: number | null;
  description: string;
}

export function validatePolishedSkills(source: ResumeAbility[], candidate: unknown): ResumeAbility[] {
  if (!Array.isArray(candidate) || candidate.length !== source.length) {
    throw new Error('润色结果的能力数量已改变');
  }
  return candidate.map((entry, index) => {
    const value = entry as Partial<ResumeAbility> | null;
    const original = source[index];
    if (!value || typeof value !== 'object' ||
      value.skill !== original.skill || value.phase !== original.phase ||
      value.evidenceCount !== original.evidenceCount ||
      value.masteryPercent !== original.masteryPercent ||
      typeof value.description !== 'string' || /\d/u.test(value.description)) {
      throw new Error('润色结果更改了受保护的事实或数字');
    }
    return { ...original, description: value.description };
  });
}
