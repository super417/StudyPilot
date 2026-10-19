import { apiRequest } from './httpClient';

export interface DirectionSummary {
  id: string;
  name: string;
  description: string;
  jobCount: number;
  courseCount: number;
  skills: string[];
}

export interface DirectionJob {
  jobId: string;
  title: string;
  companyType: string;
  city: string;
  seniority: string;
  education: string;
  majorPref: string[];
  skillsRequired: string[];
  skillsPreferred: string[];
  sourcePlatform: string;
  sourceUrl: string;
  collectedAt: string;
  verification: string;
}

export interface GapCourse {
  courseId: string;
  name: string;
  institution: string;
  provider: string;
  url: string;
  collectedAt: string;
}

export interface SkillGapItem {
  skill: string;
  requiredBy: number;
  preferredBy: number;
  jobCount: number;
  courses: GapCourse[];
}

export interface SkillGapResponse {
  status: string;
  directionId: string;
  directionName: string;
  knownSkills: string[];
  gaps: SkillGapItem[];
  coverage: { total: number; covered: number; percent: number };
}

export function fetchDirections(): Promise<{ status: string; directions: DirectionSummary[] }> {
  return apiRequest('/api/directions');
}

export function fetchDirectionJobs(
  directionId: string,
): Promise<{ status: string; directionId: string; directionName: string; jobs: DirectionJob[] }> {
  return apiRequest(`/api/directions/${encodeURIComponent(directionId)}/jobs`);
}

export function fetchSkillGap(
  directionId: string,
  known: string[],
): Promise<SkillGapResponse> {
  const params = new URLSearchParams();
  if (known.length > 0) params.set('known', known.join(','));
  const query = params.toString();
  const path = `/api/directions/${encodeURIComponent(directionId)}/skill-gap${
    query ? `?${query}` : ''
  }`;
  return apiRequest(path);
}
