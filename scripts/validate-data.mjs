#!/usr/bin/env node
/**
 * 校验 data/courses.json 与 data/jobs.json 的结构完整性。
 *
 * 用法：node scripts/validate-data.mjs
 *
 * 这个脚本存在的理由：数据文件是纯手工整理的，没有校验就会慢慢腐化——
 * 技能标签拼错、direction id 对不上、把未核实的记录当成已核实的用。
 * 竞赛规则是「宁可功能不完整，不可任何一条记录造假」，所以这里对
 * 未核实的数据只警告不报错，但演示路径上的合成数据必须能被一眼找出来。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COURSES = join(ROOT, 'data', 'courses.json');
const JOBS = join(ROOT, 'data', 'jobs.json');

const errors = [];
const warnings = [];

const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

function load(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    err(`${label} 读取失败：${e.message}`);
    return null;
  }
}

const courses = load(COURSES, 'courses.json');
const jobs = load(JOBS, 'jobs.json');

// ---------- courses.json ----------

const skillPool = new Set();

if (courses) {
  if (!courses.meta) err('courses.json 缺少 meta');
  if (!Array.isArray(courses.directions) || courses.directions.length === 0) {
    err('courses.json 缺少 directions 数组');
  }

  // meta.section_link_policy（可选）：说明章级链接怎么继承。
  // 只查形状，不判断链接深度——「章 URL 等于课程 URL」是合法的继承写法。
  // 三平台的探测证据放在 verification-log.json 的 blocked 里，不在这里要求。
  if (courses.meta?.section_link_policy !== undefined) {
    const policy = courses.meta.section_link_policy;
    if (typeof policy !== 'object' || policy === null || Array.isArray(policy)) {
      err('courses.json meta.section_link_policy 不是对象');
    } else {
      if (typeof policy.inherit !== 'string' || !policy.inherit.trim()) {
        err('meta.section_link_policy 缺少 inherit 说明');
      }
      // 其余键可选：出现时只查类型，不要求存在。
      if (policy.probes !== undefined) {
        if (!Array.isArray(policy.probes)) {
          err('meta.section_link_policy.probes 不是数组');
        } else {
          policy.probes.forEach((text, i) => {
            if (typeof text !== 'string' || !text.trim()) {
              err(`meta.section_link_policy.probes[${i}] 不是非空字符串`);
            }
          });
        }
      }
      if (
        policy.no_guessing !== undefined &&
        (typeof policy.no_guessing !== 'string' || !policy.no_guessing.trim())
      ) {
        err('meta.section_link_policy.no_guessing 不是非空字符串');
      }
    }
  }

  const dirIds = new Set();
  const courseIds = new Set();

  for (const dir of courses.directions ?? []) {
    if (!dir.id) err(`方向缺少 id：${JSON.stringify(dir.name)}`);
    if (dirIds.has(dir.id)) err(`方向 id 重复：${dir.id}`);
    dirIds.add(dir.id);

    if (!Array.isArray(dir.courses) || dir.courses.length === 0) {
      err(`方向 ${dir.id} 没有任何课程`);
      continue;
    }

    for (const c of dir.courses) {
      const where = `课程 ${c.course_id ?? '(无 id)'}`;
      if (!c.course_id) err(`${where} 缺少 course_id`);
      if (courseIds.has(c.course_id)) err(`course_id 重复：${c.course_id}`);
      courseIds.add(c.course_id);

      if (!c.name) err(`${where} 缺少 name`);
      if (!c.provider) warn(`${where} 缺少 provider（出处平台）`);
      if (!c.chapters?.length) warn(`${where} 没有任何章节`);

      // 未核实的课程：提醒，不拦。但演示前必须处理。
      if (c.verified === 'pending') {
        warn(`${where} verified=pending，不得用于演示`);
      }
      if (c.verified !== 'outline_published' && c.verified !== 'textbook_toc') {
        warn(`${where} verified=${c.verified}，章节信息未经平台核对`);
      }
      if (!c.url_verified) warn(`${where} url 未核实`);

      // 章级链接可得性（可选字段）：只查类型与自洽，不评价链接是否「打通」。
      if (c.section_link_status !== undefined) {
        if (typeof c.section_link_status !== 'string' || !c.section_link_status.trim()) {
          err(`${where} section_link_status 必须是非空字符串`);
        }
        if (typeof c.section_link_note !== 'string' || !c.section_link_note.trim()) {
          err(`${where} section_link_status 存在时必须有非空 section_link_note`);
        }
      } else if (c.section_link_note !== undefined) {
        warn(`${where} 有 section_link_note 但没有 section_link_status`);
      }

      for (const sk of c.skills ?? []) skillPool.add(sk);
      if (!c.skills?.length) warn(`${where} 没有技能标签，差距分析无法匹配`);

      for (const ch of c.chapters ?? []) {
        const chWhere = `${where} 第 ${ch.index} 章`;
        if (typeof ch.index !== 'number') err(`${chWhere} 缺少数字 index`);
        if (!ch.title) err(`${chWhere} 缺少 title`);
        if (!Array.isArray(ch.sections)) err(`${chWhere} sections 不是数组`);
        // 节级为空是合法的（只拿到模块级），但路线无法精确到节，要提醒。
        if (ch.sections?.length === 0) {
          warn(`${chWhere}「${ch.title}」没有节级内容，路线无法精确到节`);
        }

        // 章的链接元数据（可选字段）：只查类型与自洽，不评价链接是否「打通」。
        if (ch.url_verified !== undefined && typeof ch.url_verified !== 'boolean') {
          err(`${chWhere} url_verified 必须是布尔值`);
        }
        if (ch.note !== undefined && typeof ch.note !== 'string') {
          err(`${chWhere} note 必须是字符串`);
        }
        if (ch.url_verified === true && !ch.url) {
          err(`${chWhere} url_verified=true 但缺少 url`);
        }
      }
    }
  }

  // meta.retired（可选）：已剔除条目。id 不回收复用，故不得再出现在 courses 里。
  if (courses.meta?.retired !== undefined) {
    if (!Array.isArray(courses.meta.retired)) {
      err('courses.json meta.retired 不是数组');
    } else {
      for (const r of courses.meta.retired) {
        if (!r?.course_id) {
          err('meta.retired 条目缺少 course_id');
          continue;
        }
        if (!r.reason) err(`meta.retired 条目 ${r.course_id} 缺少 reason`);
        if (courseIds.has(r.course_id)) {
          err(`已剔除的 ${r.course_id} 仍出现在 courses 里`);
        }
      }
    }
  }
}

// ---------- jobs.json ----------

if (jobs) {
  if (!jobs.meta) err('jobs.json 缺少 meta');
  if (!Array.isArray(jobs.directions) || jobs.directions.length === 0) {
    err('jobs.json 缺少 directions 数组');
  }

  let syntheticCount = 0;
  let realCount = 0;
  const jobDirIds = new Set();

  for (const dir of jobs.directions ?? []) {
    if (!dir.id) err(`岗位方向缺少 id：${JSON.stringify(dir.name)}`);
    jobDirIds.add(dir.id);

    if (!Array.isArray(dir.jobs) || dir.jobs.length === 0) {
      err(`方向 ${dir.id} 没有任何岗位记录`);
      continue;
    }

    const jobIds = new Set();
    for (const j of dir.jobs) {
      const where = `岗位 ${j.job_id ?? '(无 id)'}`;
      if (!j.job_id) err(`${where} 缺少 job_id`);
      if (jobIds.has(j.job_id)) err(`job_id 重复：${j.job_id}`);
      jobIds.add(j.job_id);

      if (!j.title) err(`${where} 缺少 title`);
      if (j.verification === 'collected') {
        realCount++;
        // 采集来的记录必须能追溯。
        if (!j.source_platform) err(`${where} verification=collected 但缺少 source_platform`);
        if (!j.source_url) err(`${where} verification=collected 但缺少 source_url`);
        if (!j.collected_at) err(`${where} verification=collected 但缺少 collected_at`);
      } else {
        syntheticCount++;
      }

      if (!j.skills_required?.length) warn(`${where} 没有 skills_required`);

      // 技能标签必须能在课程库里找到，否则差距分析永远补不上。
      for (const sk of [
        ...(j.skills_required ?? []),
        ...(j.skills_preferred ?? []),
      ]) {
        if (skillPool.size > 0 && !skillPool.has(sk)) {
          warn(`${where} 技能「${sk}」在 courses.json 中无对应课程，永远无法补齐`);
        }
      }
    }
  }

  // 两个文件的 direction id 必须一致。
  if (courses) {
    for (const id of courses.directions?.map((d) => d.id) ?? []) {
      if (!jobDirIds.has(id)) err(`方向 ${id} 在 courses.json 有、在 jobs.json 没有`);
    }
    for (const id of jobDirIds) {
      if (!courses.directions?.some((d) => d.id === id)) {
        err(`方向 ${id} 在 jobs.json 有、在 courses.json 没有`);
      }
    }
  }

  console.log('岗位记录：真实采集 %d 条，合成 %d 条', realCount, syntheticCount);
  if (syntheticCount > 0) {
    warn(
      `仍有 ${syntheticCount} 条合成岗位记录（verification=synthetic_from_curriculum）。` +
        '竞赛演示前必须替换为真实采集数据，或从演示路径中移除。'
    );
  }
}

// ---------- 输出 ----------

for (const w of warnings) console.log('⚠️  ' + w);
for (const e of errors) console.log('❌ ' + e);

console.log(
  `\n课程 ${skillPool.size} 个技能标签；错误 ${errors.length}，警告 ${warnings.length}`
);

if (errors.length > 0) {
  console.log('\n校验未通过。');
  process.exit(1);
}
console.log('\n校验通过。');
