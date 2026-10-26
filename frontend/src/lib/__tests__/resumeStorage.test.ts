import { describe, expect, it } from 'vitest';

import { countResumes, mergeResumePayloads } from '@/lib/resumeStorage';

function payload(
  resumes: Record<string, { updatedAt: string; title?: string }>,
  activeResumeId: string | null = null,
  version = 3,
): string {
  return JSON.stringify({
    state: { resumes, activeResumeId },
    version,
  });
}

describe('mergeResumePayloads', () => {
  it('本地为空时直接采用云端快照', () => {
    const remote = payload({ a: { updatedAt: '2026-10-24T10:00:00.000Z', title: '云端简历' } }, 'a');
    const merged = mergeResumePayloads(null, remote);
    expect(merged).not.toBeNull();
    const parsed = JSON.parse(merged as string);
    expect(Object.keys(parsed.state.resumes)).toEqual(['a']);
    expect(parsed.state.resumes.a.title).toBe('云端简历');
    expect(parsed.state.activeResumeId).toBe('a');
  });

  it('两边各有独立简历时按 id 取并集', () => {
    const local = payload({ a: { updatedAt: '2026-10-24T10:00:00.000Z' } }, 'a');
    const remote = payload({ b: { updatedAt: '2026-10-24T09:00:00.000Z' } }, 'b');
    const merged = JSON.parse(mergeResumePayloads(local, remote) as string);
    expect(Object.keys(merged.state.resumes).sort()).toEqual(['a', 'b']);
    expect(merged.state.activeResumeId).toBe('a');
  });

  it('同一份简历以 updatedAt 较新的为准（云端更新时用云端）', () => {
    const local = payload({ a: { updatedAt: '2026-10-24T09:00:00.000Z', title: '本地旧版' } }, 'a');
    const remote = payload({ a: { updatedAt: '2026-10-24T11:00:00.000Z', title: '云端新版' } }, 'a');
    const merged = JSON.parse(mergeResumePayloads(local, remote) as string);
    expect(merged.state.resumes.a.title).toBe('云端新版');
  });

  it('同一份简历本地更新时不回退到云端', () => {
    const local = payload({ a: { updatedAt: '2026-10-24T12:00:00.000Z', title: '本地新版' } }, 'a');
    const remote = payload({ a: { updatedAt: '2026-10-24T11:00:00.000Z', title: '云端旧版' } }, 'a');
    const merged = JSON.parse(mergeResumePayloads(local, remote) as string);
    expect(merged.state.resumes.a.title).toBe('本地新版');
  });

  it('activeResumeId 指向不存在的简历时回落到第一份', () => {
    const local = payload({ a: { updatedAt: '2026-10-24T10:00:00.000Z' } }, 'missing');
    const merged = JSON.parse(mergeResumePayloads(local, null) as string);
    expect(merged.state.activeResumeId).toBe('a');
  });

  it('保留本地持久化版本号，避免编辑器触发迁移丢数据', () => {
    const local = payload({ a: { updatedAt: '2026-10-24T10:00:00.000Z' } }, 'a', 7);
    const remote = payload({ b: { updatedAt: '2026-10-24T10:00:00.000Z' } }, 'b', 3);
    const merged = JSON.parse(mergeResumePayloads(local, remote) as string);
    expect(merged.version).toBe(7);
  });

  it('两边都是坏数据时返回 null', () => {
    expect(mergeResumePayloads('{oops', 'not-json')).toBeNull();
  });

  it('countResumes 统计简历条数', () => {
    expect(countResumes(null)).toBe(0);
    expect(countResumes(payload({ a: { updatedAt: '2026-10-24T10:00:00.000Z' } }))).toBe(1);
  });
});
