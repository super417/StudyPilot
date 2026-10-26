import { describe, expect, it } from 'vitest';
import type { LatestPlanResponse } from './plansApi';
import type { ResumeAbility } from './resumePolish';
import { buildAboutText, buildAchievementPairs, buildAdvantages, buildDisplayAbilities, careerSkillFromPhase, formatPhaseSource, inferProfessionalSkills, readPersonalResumeFacts } from './personalWebsiteResumeData';

function ability(skill: string, evidenceCount: number, masteryPercent: number | null): ResumeAbility {
  return { skill, phase: `第 1 阶段：${skill}`, evidenceCount, masteryPercent, description: '原描述' };
}

function phase(phaseIndex: number, name: string, progressPercent = 0): LatestPlanResponse['phases'][number] {
  return { id: String(phaseIndex), phaseIndex, name, startDate: '', endDate: '', progressPercent, isCurrent: false, isCompleted: false };
}

describe('personal website resume display', () => {
  it('fills three ability cards from planned future stages without claiming they are achievements', () => {
    const items = buildDisplayAbilities(
      { verified: [ability('Python 基础', 5, 80)], learned: [], awaiting: [] },
      [phase(1, 'Python 基础', 100), phase(2, '数据分析'), phase(3, '可视化')],
    );
    expect(items).toHaveLength(3);
    expect(items.map(item => item.status)).toEqual(['已验证能力', '待获得', '待获得']);
    expect(items[1]).toMatchObject({ skill: '数据分析的实际应用', evidenceCount: 0, masteryPercent: null });
    expect(items[1].description).toContain('学完');
  });

  it('uses the requested learned description and never duplicates a stage', () => {
    const items = buildDisplayAbilities(
      { verified: [], learned: [ability('Python 基础', 14, 32)], awaiting: [] },
      [phase(1, 'Python 基础', 100), phase(2, '数据分析', 40), phase(3, '可视化')],
    );
    expect(items).toHaveLength(3);
    expect(items[0].description).toBe('完成该阶段学习所获得的具体的技能');
    expect(items.map(item => item.status)).toEqual(['已学习未验证', '学习中', '待获得']);
  });

  it('uses honest planning placeholders when fewer than three real phases exist', () => {
    const items = buildDisplayAbilities({ verified: [], learned: [], awaiting: [] }, []);
    expect(items).toHaveLength(3);
    expect(items.every(item => item.status === '待规划')).toBe(true);
    expect(items.every(item => item.masteryPercent === null && item.evidenceCount === 0)).toBe(true);
  });

  it('keeps distinct plan stages even when their titles match', () => {
    const items = buildDisplayAbilities(
      { verified: [], learned: [], awaiting: [] },
      [phase(1, '基础训练'), phase(2, '基础训练'), phase(3, '实践')],
    );
    expect(items.map(item => item.phase)).toEqual([
      '第 1 阶段：基础训练', '第 2 阶段：基础训练', '第 3 阶段：实践',
    ]);
    expect(items[0].skill).toBe('基础训练的实际应用');
  });

  it('reads only the active user resume fields from the saved document', () => {
    const payload = JSON.stringify({ state: { activeResumeId: 'mine', resumes: {
      other: { basic: { name: '他人' }, education: [{ school: '其他学校' }] },
      mine: {
        basic: { name: '小明', email: 'secret@example.com' },
        education: [{ school: '某大学', major: '统计学', visible: true }],
        certificates: [{ name: '数据分析证书', visible: true }],
        skillContent: '<ul><li>统计建模</li><li>数据清洗</li></ul>',
      },
    } } });
    const facts = readPersonalResumeFacts(payload);
    expect(facts).toEqual({ name: '小明', school: '某大学', major: '统计学', certificates: ['数据分析证书'], professionalSkills: ['统计建模', '数据清洗'] });
    expect(JSON.stringify(facts)).not.toContain('secret@example.com');
    expect(JSON.stringify(facts)).not.toContain('其他学校');
  });

  it('leaves empty school, major and certificates out of the about paragraph', () => {
    const text = buildAboutText({
      nickname: '小明', bio: '', facts: readPersonalResumeFacts(null), verified: [],
    });
    expect(text).toContain('学校和专业尚未填写');
    expect(text).not.toContain('规划后可学习');
    expect(text).not.toContain('学校：');
    expect(text).not.toContain('专业：');
    expect(text).not.toContain('已获证书（自填）：');
    expect(text).not.toContain('学习成果将在取得作答证据后展示');
  });

  it('keeps verified skills separate from professional and planned skills', () => {
    const facts = { name: '', school: '某大学', major: '统计学', certificates: ['数据分析证书'], professionalSkills: ['统计建模'] };
    const text = buildAboutText({ nickname: '小明', bio: '擅长整理数据', facts, verified: [ability('Python 基础', 5, 80), ability('未验证', 0, 80)] });
    expect(text).toContain('学校：某大学');
    expect(text).toContain('统计学专业');
    expect(text).toContain('已获证书（自填）：数据分析证书');
    expect(text).toContain('专业技能（自填）：统计建模');
    expect(text).toContain('已验证能力：Python 基础的实际应用');
    expect(text).not.toContain('规划后可学习');
    expect(text).not.toContain('未验证的实际应用');
  });

  it('uses planned course skills beyond the user-entered professional skills for advantages', () => {
    expect(buildAdvantages([phase(1, '统计建模'), phase(2, '金融数据分析'), phase(3, '风险评估')], ['统计建模'])).toEqual(['金融数据分析的实际应用', '风险评估的实际应用']);
    expect(buildAdvantages([{ ...phase(1, '阶段一：Python 编程基础与数据分析环境搭建'), isCompleted: true }], [])).toEqual(['运用 Python 编写数据分析脚本']);
  });

  it('turns the current plan stages into job-useful capability wording without stage titles', () => {
    expect(careerSkillFromPhase('阶段一：Python 编程基础与数据分析环境搭建')).toBe('运用 Python 编写数据分析脚本');
    expect(careerSkillFromPhase('阶段二：NumPy 与 Pandas 数据处理核心')).toBe('使用 NumPy 与 Pandas 处理数据');
    expect(careerSkillFromPhase('阶段三：可视化、统计基础与探索性分析')).toBe('制作数据可视化并开展统计与探索性分析');
    expect(careerSkillFromPhase('阶段四：独立完成数据分析小项目与讲解输出')).toBe('完成数据分析项目并讲解分析结论');
    expect(formatPhaseSource('第 3 阶段：阶段三：可视化、统计基础与探索性分析')).toBe('第 3 阶段');
  });

  it('does not claim an unverified professional skill from a school or major', () => {
    expect(inferProfessionalSkills('统计学')).toHaveLength(5);
    const facts = { name: '', school: '某大学', major: '统计学', certificates: [], professionalSkills: [] };
    const text = buildAboutText({ nickname: '小明', bio: '', facts, verified: [] });
    expect(text).toContain('专业相关技能：');
    expect(text).not.toContain('（依据专业推测，待确认）');
    expect(text).not.toContain('已掌握');
    expect(inferProfessionalSkills('未知专业')).toEqual([]);
  });

  it('lists three concrete stage skills without claiming low-mastery or future skills are verified', () => {
    const stages = [
      phase(1, '阶段一：Python 编程基础与数据分析环境搭建', 100),
      phase(2, '阶段二：NumPy 与 Pandas 数据处理核心'),
      phase(3, '阶段三：可视化、统计基础与探索性分析'),
    ];
    const items = buildDisplayAbilities({ verified: [], learned: [ability(stages[0].name, 14, 32)], awaiting: [] }, stages);
    expect(items).toHaveLength(3);
    expect(items.every(item => item.skillPoints.length >= 3)).toBe(true);
    expect(items[0].status).toBe('已学习未验证');
    expect(items[1].status).toBe('待获得');
    expect(items[0].skillPoints).toContain('编写 Python 基础脚本');
    expect(items[1].skillPoints).toContain('使用 NumPy 处理数组数据');
  });

  it('uses assigned task topics for a stage outside the known skill categories', () => {
    const items = buildDisplayAbilities(
      { verified: [], learned: [], awaiting: [] },
      [phase(1, '数据库基础')],
      { '1': [
        { description: '学习 SQL 查询与筛选', sectionTitle: 'SQL 查询与筛选' },
        { description: '练习数据库表设计', sectionTitle: '数据库表设计' },
        { description: '完成多表关联查询', sectionTitle: '多表关联查询' },
      ] },
    );
    expect(items[0].skillPoints).toHaveLength(3);
    expect(items[0].skillPoints).toEqual(['SQL 查询与筛选', '数据库表设计', '多表关联查询']);
    expect(items[0].status).toBe('待获得');
  });

  it('uses account education over editor education and labels generated examples', () => {
    const facts = { name: '', school: '旧学校', major: '旧专业', certificates: [], professionalSkills: [] };
    const text = buildAboutText({ nickname: 'super', bio: '', facts, verified: [], school: '上海财经大学（示例，待确认）', major: '统计学（示例，待确认）' });
    expect(text).toContain('学校示例（待确认）：上海财经大学');
    expect(text).toContain('专业示例（待确认）：统计学');
    expect(text).not.toContain('旧学校');
    expect(text).not.toContain('就读学校');
    expect(text).toContain('专业相关技能：统计分析、数据解读、概率与统计基础、数据建模基础、统计结果可视化');
  });

  it('pairs three cards with self-entered skills first and keeps course status', () => {
    const facts = { name: '', school: '', major: '统计学', certificates: [], professionalSkills: ['金融报表解读'] };
    const abilities = buildDisplayAbilities(
      { verified: [ability('阶段一：Python 编程基础与数据分析环境搭建', 8, 75)], learned: [], awaiting: [] },
      [phase(1, '阶段一：Python 编程基础与数据分析环境搭建', 100), phase(2, '阶段二：NumPy 与 Pandas 数据处理核心'), phase(3, '阶段三：可视化、统计基础与探索性分析')],
    );
    const pairs = buildAchievementPairs(facts, '统计学', abilities);
    expect(pairs).toHaveLength(3);
    expect(pairs[0]).toMatchObject({ professionalSkill: '金融报表解读', professionalSource: '用户自填' });
    expect(pairs[0].ability?.status).toBe('已验证能力');
    expect(pairs[1].professionalSource).toBe('专业相关');
    expect(pairs[1].ability?.status).toBe('待获得');
    expect(pairs[2].ability?.status).toBe('待获得');
  });

  it('does not invent existing skills or achievements when profile and plan are empty', () => {
    const pairs = buildAchievementPairs(readPersonalResumeFacts(null), '', buildDisplayAbilities({ verified: [], learned: [], awaiting: [] }, []));
    expect(pairs).toHaveLength(3);
    expect(pairs.every(pair => pair.professionalSkill === null && pair.ability === null)).toBe(true);
  });
});
