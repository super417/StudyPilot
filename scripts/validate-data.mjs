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
