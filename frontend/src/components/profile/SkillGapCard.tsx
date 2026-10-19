import { useCallback, useEffect, useState } from 'react';
import { Compass } from 'lucide-react';
import CardShell from './CardShell';
import { CardEmpty, CardError, CardLoading } from './states';
import { ApiError } from '@/lib/httpClient';
import {
  fetchDirectionJobs,
  fetchDirections,
  fetchSkillGap,
  type DirectionJob,
  type DirectionSummary,
  type SkillGapResponse,
} from '@/lib/directionsApi';

/** 方向技能差距诊断（只读规则计算，不生成路线）。 */
function SkillGapCard() {
  const [directions, setDirections] = useState<DirectionSummary[]>([]);
  const [loadingDirs, setLoadingDirs] = useState(true);
  const [dirsError, setDirsError] = useState<string | null>(null);

  const [directionId, setDirectionId] = useState<string>('');
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [gap, setGap] = useState<SkillGapResponse | null>(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [gapError, setGapError] = useState<string | null>(null);

  const [jobsOpen, setJobsOpen] = useState(false);
  const [jobs, setJobs] = useState<DirectionJob[] | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingDirs(true);
    setDirsError(null);
    fetchDirections()
      .then((res) => {
        if (cancelled) return;
        setDirections(res.directions);
        if (res.directions.length > 0) {
          setDirectionId((prev) => prev || res.directions[0].id);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDirsError(err instanceof ApiError ? err.message : '加载方向失败');
      })
      .finally(() => {
        if (!cancelled) setLoadingDirs(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = directions.find((d) => d.id === directionId) ?? null;

  useEffect(() => {
    setKnown(new Set());
    setGap(null);
    setGapError(null);
    setJobs(null);
    setJobsOpen(false);
    setJobsError(null);
  }, [directionId]);

  const toggleSkill = (skill: string) => {
    setKnown((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });
  };

  const runGap = useCallback(async () => {
    if (!directionId) return;
    setGapLoading(true);
    setGapError(null);
    try {
      const res = await fetchSkillGap(directionId, Array.from(known));
      setGap(res);
    } catch (err: unknown) {
      setGap(null);
      setGapError(err instanceof ApiError ? err.message : '计算差距失败');
    } finally {
      setGapLoading(false);
    }
  }, [directionId, known]);

  const loadJobs = useCallback(async () => {
    if (!directionId) return;
    if (jobsOpen) {
      setJobsOpen(false);
      return;
    }
    setJobsOpen(true);
    if (jobs) return;
    setJobsLoading(true);
    setJobsError(null);
    try {
      const res = await fetchDirectionJobs(directionId);
      setJobs(res.jobs);
    } catch (err: unknown) {
      setJobsError(err instanceof ApiError ? err.message : '加载岗位失败');
    } finally {
      setJobsLoading(false);
    }
  }, [directionId, jobs, jobsOpen]);

  return (
    <CardShell title="方向技能差距" icon={<Compass size={17} aria-hidden="true" />}>
      {loadingDirs ? (
        <CardLoading />
      ) : dirsError ? (
        <CardError message={dirsError} />
      ) : directions.length === 0 ? (
        <CardEmpty>暂无就业方向数据</CardEmpty>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {directions.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDirectionId(d.id)}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  d.id === directionId
                    ? 'bg-brand text-white'
                    : 'bg-brandFaint text-brandDark hover:bg-brand/20'
                }`}
              >
                {d.name}
              </button>
            ))}
          </div>

          {selected ? (
            <p className="text-xs leading-relaxed text-gray-500">
              {selected.description}
              <span className="mt-1 block text-gray-400">
                {selected.jobCount} 个岗位 · {selected.courseCount} 门课
              </span>
            </p>
          ) : null}

          <div>
            <p className="mb-2 text-xs text-gray-400">我已经会这些（勾选后查看差距）</p>
            <div className="flex flex-wrap gap-2">
              {(selected?.skills ?? []).map((skill) => {
                const checked = known.has(skill);
                return (
                  <label
                    key={skill}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm ${
                      checked
                        ? 'border-brand bg-brandFaint text-brandDark'
                        : 'border-brandFaint text-gray-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSkill(skill)}
                      className="h-3.5 w-3.5 accent-brand"
                    />
                    {skill}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runGap}
              disabled={gapLoading || !directionId}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brandDark disabled:opacity-60"
            >
              {gapLoading ? '计算中…' : '查看差距'}
            </button>
            <button
              type="button"
              onClick={loadJobs}
              disabled={!directionId}
              className="rounded-lg px-3 py-1.5 text-sm text-brandDark transition hover:bg-brandFaint disabled:opacity-60"
            >
              {jobsOpen ? '收起岗位来源' : '查看岗位来源'}
            </button>
          </div>

          {jobsOpen ? (
            <div className="rounded-lg border border-brandFaint bg-white/60 p-3">
              {jobsLoading ? (
                <CardLoading />
              ) : jobsError ? (
                <CardError message={jobsError} />
              ) : jobs && jobs.length > 0 ? (
                <ul className="space-y-2">
                  {jobs.map((job) => (
                    <li key={job.jobId} className="text-sm text-gray-700">
                      <span className="font-medium text-brandDark">{job.title}</span>
                      <span className="text-gray-400">
                        {' '}
                        · {job.city} · {job.sourcePlatform}
                      </span>
                      {job.sourceUrl ? (
                        <a
                          href={job.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-2 text-brand hover:underline"
                        >
                          核对原文
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <CardEmpty>该方向暂无岗位记录</CardEmpty>
              )}
            </div>
          ) : null}

          {gapError ? <CardError message={gapError} /> : null}

          {gap ? (
            <div className="space-y-3 border-t border-brandFaint pt-4">
              <p className="text-sm text-brandDark">
                覆盖率 {gap.coverage.covered}/{gap.coverage.total}（{gap.coverage.percent}%）
              </p>
              {gap.gaps.length === 0 ? (
                <CardEmpty>当前勾选已覆盖岗位技能词表中的可对齐项</CardEmpty>
              ) : (
                <ul className="space-y-3">
                  {gap.gaps.map((item) => (
                    <li key={item.skill} className="rounded-lg border border-brandFaint p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-medium text-brandDark">{item.skill}</p>
                        <p className="text-xs text-gray-400">
                          {item.requiredBy} 岗硬性要求
                          {item.preferredBy > 0 ? ` · ${item.preferredBy} 岗加分` : ''}
                          {' · '}共 {item.jobCount} 岗
                        </p>
                      </div>
                      {item.courses.length === 0 ? (
                        <p className="mt-2 text-sm text-gray-400">暂无可直接抵达的课程</p>
                      ) : (
                        <ul className="mt-2 space-y-1.5">
                          {item.courses.map((course) => (
                            <li key={course.courseId} className="text-sm text-gray-700">
                              <a
                                href={course.url}
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium text-brand hover:underline"
                              >
                                {course.name}
                              </a>
                              <span className="text-gray-400">
                                {' '}
                                · {course.institution} · {course.provider}
                                {course.collectedAt ? ` · 整理于 ${course.collectedAt}` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      )}
    </CardShell>
  );
}

export default SkillGapCard;
