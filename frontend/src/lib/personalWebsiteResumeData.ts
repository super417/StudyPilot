import type { LatestPlanResponse } from './plansApi';
import type { ResumeAbility } from './resumePolish';

interface ResumeBuckets {
  verified: ResumeAbility[];
  learned: ResumeAbility[];
  awaiting: ResumeAbility[];
}

export interface DisplayAbility extends ResumeAbility {
  status: '已验证能力' | '已学习未验证' | '学习中' | '待获得' | '待规划';
  skillPoints: string[];
}

type PhaseTaskTopics = Record<string, Array<{ description: string; sectionTitle?: string | null; chapterTitle?: string | null }>>;

/** 阶段标题与任务只用于归纳技能方向；具体技能点没有独立的作答判分。 */
function phaseSkillPoints(title: string, tasks: PhaseTaskTopics[string] = []): string[] {
  if (/Python/iu.test(title) && /编程|环境搭建/u.test(title))
    return ['编写 Python 基础脚本', '配置 Python 数据分析环境', '使用 Python 处理基础数据'];
  if (/NumPy/iu.test(title) && /Pandas/iu.test(title))
    return ['使用 NumPy 处理数组数据', '使用 Pandas 读取表格数据', '使用 Pandas 整理与分析数据'];
  if (/可视化/u.test(title) && /探索性分析/u.test(title))
    return ['制作数据可视化图表', '运用统计基础解读数据', '开展探索性数据分析'];
  if (/数据分析/u.test(title) && /项目/u.test(title) && /讲解|输出/u.test(title))
    return ['完成数据分析小项目', '整理分析过程与结论', '讲解数据分析结果'];
  return [...new Set(tasks.map(task => (task.sectionTitle || task.chapterTitle || task.description).trim()
    .replace(/^(?:学习|练习|完成|掌握|了解|阅读|复习)\s*/u, '')).filter(Boolean))].slice(0, 3);
}

/** 将规划阶段的课程标题转换为岗位可用的能力表述，不改变证据和掌握度。 */
export function careerSkillFromPhase(value: string): string {
  const title = value.trim()
    .replace(/^第\s*\d+\s*阶段\s*[:：]\s*/u, '')
    .replace(/^阶段\s*[一二三四五六七八九十\d]+\s*[:：]\s*/u, '')
    .trim();
  if (/Python/iu.test(title) && /编程|环境搭建/u.test(title)) return '运用 Python 编写数据分析脚本';
  if (/NumPy/iu.test(title) && /Pandas/iu.test(title)) return '使用 NumPy 与 Pandas 处理数据';
  if (/可视化/u.test(title) && /探索性分析/u.test(title)) return '制作数据可视化并开展统计与探索性分析';
  if (/数据分析/u.test(title) && /项目/u.test(title) && /讲解|输出/u.test(title)) return '完成数据分析项目并讲解分析结论';
  return title ? `${title}的实际应用` : '';
}

export function formatPhaseSource(value: string | null): string {
  if (!value) return '尚无对应阶段';
  const number = value.match(/第\s*(\d+)\s*阶段/u);
  return number ? `第 ${number[1]} 阶段` : value;
}

export function inferProfessionalSkills(major: string): string[] {
  if (/统计/u.test(major)) return ['统计分析', '数据解读', '概率与统计基础', '数据建模基础', '统计结果可视化'];
  if (/数据科学|数据分析/u.test(major)) return ['数据处理', '数据分析', '数据可视化', '统计基础', '数据建模基础'];
  if (/计算机|软件工程/u.test(major)) return ['程序设计', '软件开发', '数据结构', '算法基础', '软件测试'];
  if (/金融/u.test(major)) return ['金融分析', '风险评估基础', '金融市场基础', '财务报表解读', '投资分析基础'];
  if (/会计|财务/u.test(major)) return ['会计核算', '财务分析', '财务报表编制', '成本核算', '预算管理基础'];
  return [];
}

export interface PersonalResumeFacts {
  name: string;
  school: string;
  major: string;
  certificates: string[];
  professionalSkills: string[];
}

const EMPTY_FACTS: PersonalResumeFacts = { name: '', school: '', major: '', certificates: [], professionalSkills: [] };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function plainText(value: string): string {
  return value.replace(/<[^>]*>/gu, ' ').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/giu, entity => ({
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  })[entity.toLowerCase()] ?? entity).replace(/\s+/gu, ' ').trim();
}

/** 只读取当前登录账号保存的简历快照中正在编辑的简历，不使用其他简历或浏览器旧缓存。 */
export function readPersonalResumeFacts(payload: string | null): PersonalResumeFacts {
  if (!payload) return { ...EMPTY_FACTS };
  try {
    const state = record(record(JSON.parse(payload))?.state);
    const resumes = record(state?.resumes);
    const activeId = str(state?.activeResumeId);
    const active = activeId ? record(resumes?.[activeId]) : null;
    if (!active) return { ...EMPTY_FACTS };
    const basic = record(active.basic) ?? record(active.personalInfo);
    const education = Array.isArray(active.education) ? active.education.map(record).filter(item => item && item.visible !== false) : [];
    const firstEducation = education.find(item => str(item?.school) || str(item?.major));
    const certificates = Array.isArray(active.certificates) ? active.certificates : active.certifications;
    const certificateNames = Array.isArray(certificates) ? certificates.map(record).filter(item => item && item.visible !== false).map(item => str(item?.name) || str(item?.title)).filter(Boolean) : [];
    const skillContent = str(active.skillContent);
    const listItems = [...skillContent.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/giu)].map(match => plainText(match[1])).filter(Boolean);
    const legacySkills = Array.isArray(active.skills) ? active.skills.flatMap(item => {
      if (typeof item === 'string') return [item.trim()];
      const skills = record(item)?.skills;
      return Array.isArray(skills) ? skills.map(str) : [];
    }) : [];
    return {
      name: str(basic?.name),
      school: str(firstEducation?.school),
      major: str(firstEducation?.major),
      certificates: [...new Set(certificateNames)],
      professionalSkills: [...new Set((listItems.length ? listItems : skillContent ? [plainText(skillContent)] : legacySkills).filter(Boolean))],
    };
  } catch {
    return { ...EMPTY_FACTS };
  }
}

/** 规划阶段只作为未来目标展示；没有证据的内容不能成为已获成就。 */
export function buildDisplayAbilities(resume: ResumeBuckets, phases: LatestPlanResponse['phases'], phaseTasks: PhaseTaskTopics = {}): DisplayAbility[] {
  const pointsFor = (item: ResumeAbility) => {
    const phase = phases.find(row => item.phase === `第 ${row.phaseIndex} 阶段：${row.name}` || item.skill === row.name);
    return phaseSkillPoints(phase?.name || item.skill, phase ? phaseTasks[phase.id] : []);
  };
  const items: DisplayAbility[] = [
    ...resume.verified.map(item => ({ ...item, skill: careerSkillFromPhase(item.skill) || item.skill, skillPoints: pointsFor(item), status: '已验证能力' as const })),
    ...resume.learned.map(item => ({ ...item, skill: careerSkillFromPhase(item.skill) || item.skill, skillPoints: pointsFor(item), status: '已学习未验证' as const, description: '完成该阶段学习所获得的具体的技能' })),
    ...resume.awaiting.map(item => ({ ...item, skill: careerSkillFromPhase(item.skill) || item.skill, skillPoints: pointsFor(item), status: '待获得' as const })),
  ];
  const seen = new Set(items.map(item => (item.phase || item.skill).trim()));
  for (const phase of [...phases].sort((a, b) => a.phaseIndex - b.phaseIndex)) {
    const title = phase.name.trim();
    const skill = careerSkillFromPhase(title);
    const phaseLabel = `第 ${phase.phaseIndex} 阶段：${title}`;
    if (!title || seen.has(phaseLabel) || seen.has(title)) continue;
    seen.add(phaseLabel);
    items.push({
      skill,
      phase: phaseLabel,
      evidenceCount: 0,
      masteryPercent: null,
      description: phase.progressPercent > 0
        ? '正在学习该阶段；能力尚未通过作答证据验证。'
        : '学完该阶段后可获得的目标技能，当前尚未验证。',
      status: phase.progressPercent > 0 ? '学习中' : '待获得',
      skillPoints: phaseSkillPoints(title, phaseTasks[phase.id]),
    });
  }
  while (items.length < 3) {
    const number = items.length + 1;
    items.push({
      skill: `待规划阶段 ${number}`,
      phase: '尚无对应课程阶段',
      evidenceCount: 0,
      masteryPercent: null,
      description: '设定更多学习阶段后，这里会显示未来目标技能。',
      status: '待规划',
      skillPoints: [],
    });
  }
  return items;
}

export interface AchievementPair {
  professionalSkill: string | null;
  professionalSource: '用户自填' | '专业相关' | null;
  ability: DisplayAbility | null;
}

/** 三张卡片组合专业背景与课程能力，保留各自来源和验证状态。 */
export function buildAchievementPairs(facts: PersonalResumeFacts, major: string, abilities: DisplayAbility[]): AchievementPair[] {
  const confirmed = [...new Set(facts.professionalSkills.map(skill => skill.trim()).filter(Boolean))];
  const inferred = inferProfessionalSkills((major.trim() || facts.major).replace(/（示例，待确认）$/u, ''))
    .filter(skill => !confirmed.includes(skill));
  const candidates = [
    ...confirmed.map(skill => ({ skill, source: '用户自填' as const })),
    ...inferred.map(skill => ({ skill, source: '专业相关' as const })),
  ];
  const courseAbilities = abilities.filter(item => item.status !== '待规划');
  const used = new Set<string>();
  const keywords = ['Python', 'NumPy', 'Pandas', 'AI', '数据', '分析', '统计', '可视化', '模型', '金融', '风险', '编程', '项目'];
  return Array.from({ length: 3 }, (_, index) => {
    const ability = courseAbilities[index] ?? null;
    const remaining = candidates.filter(candidate => !used.has(candidate.skill));
    const selfEntered = remaining.filter(candidate => candidate.source === '用户自填');
    const pool = selfEntered.length ? selfEntered : remaining;
    const score = (skill: string) => ability ? keywords.reduce((total, word) =>
      total + (skill.includes(word) && `${ability.skill} ${ability.skillPoints.join(' ')}`.includes(word) ? word.length : 0), 0) : 0;
    const selected = pool.reduce<(typeof candidates)[number] | null>((best, candidate) =>
      !best || score(candidate.skill) > score(best.skill) ? candidate : best, null);
    if (selected) used.add(selected.skill);
    return {
      professionalSkill: selected?.skill ?? null,
      professionalSource: selected?.source ?? null,
      ability,
    };
  });
}

export function buildAdvantages(phases: LatestPlanResponse['phases'], professionalSkills: string[]): string[] {
  const professional = new Set(professionalSkills.map(skill => skill.trim().toLowerCase()));
  return [...new Set(phases
    .map(phase => phase.name.trim())
    .filter(title => title && !professional.has(title.toLowerCase()))
    .map(careerSkillFromPhase)
    .filter(skill => skill && !professional.has(skill.toLowerCase())))];
}

export function buildAboutText({ nickname, bio, facts, verified, school, major }: {
  nickname: string;
  bio: string;
  facts: PersonalResumeFacts;
  verified: ResumeAbility[];
  school?: string;
  major?: string;
}): string {
  const displayName = facts.name || nickname.trim();
  const parts = [displayName ? `我是${displayName}。` : '', bio.trim()];
  const schoolValue = school?.trim() || facts.school;
  const majorValue = major?.trim() || facts.major;
  const sampleSuffix = '（示例，待确认）';
  const schoolSample = schoolValue.endsWith(sampleSuffix);
  const majorSample = majorValue.endsWith(sampleSuffix);
  const schoolName = schoolSample ? schoolValue.slice(0, -sampleSuffix.length) : schoolValue;
  const majorName = majorSample ? majorValue.slice(0, -sampleSuffix.length) : majorValue;
  if (schoolName && majorName) parts.push(schoolSample || majorSample
    ? `${schoolSample ? '学校示例（待确认）' : '学校'}：${schoolName}；${majorSample ? '专业示例（待确认）' : '专业'}：${majorName}。`
    : `学校：${schoolName}，${majorName}专业。`);
  else if (schoolName) parts.push(`${schoolSample ? '学校示例（待确认）' : '学校'}：${schoolName}。专业尚未填写。`);
  else if (majorName) parts.push(`学校尚未填写。${majorSample ? '专业示例（待确认）' : '专业'}：${majorName}。`);
  else parts.push('学校和专业尚未填写。');
  if (facts.certificates.length) parts.push(`已获证书（自填）：${facts.certificates.join('、')}。`);
  if (facts.professionalSkills.length) parts.push(`专业技能（自填）：${facts.professionalSkills.join('、')}。`);
  const inferred = inferProfessionalSkills(majorName);
  if (inferred.length) parts.push(`专业相关技能：${inferred.join('、')}。`);
  else if (!facts.professionalSkills.length) parts.push('专业技能尚无可确认资料。');
  const skills = [...new Set(verified
    .filter(item => item.evidenceCount > 0 && item.masteryPercent !== null && item.masteryPercent >= 60)
    .map(item => careerSkillFromPhase(item.skill))
    .filter(Boolean))];
  if (skills.length) parts.push(`已验证能力：${skills.join('、')}。`);
  return parts.filter(Boolean).join(' ');
}
