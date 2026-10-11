// 相对路径，避免目标表单探针把 `@/lib/httpClient` 替换后丢掉 apiRequest。
import { apiRequest } from './httpClient';

export interface MaterialFacts {
  excerpts: Array<{ chunkIndex: number; content: string; contentHash: string; pageStart: number | null }>;
  unreadChunkCount: number;
  unreadNote: string;
  basisNote?: string;
  prerequisite: string;
  coverage: string;
  duration: { status: string; playSeconds: number | null; note: string };
}

export interface MaterialCandidate {
  candidateId: string;
  kind: 'document' | 'link';
  readStatus: 'read' | 'title_only' | 'failed';
  displayName: string;
  source: { docId?: string; url?: string };
  usableSource?: boolean;
  facts: MaterialFacts;
}

export interface MaterialComparisonResponse {
  comparisonId: string;
  planId: string | null;
  goal: {
    goalName: string;
    goalDate: string;
    currentLevel: string;
    dailyMinutes: number;
    completionCriterion: string | null;
    completionCriterionLabel: string;
  };
  selectedCandidateId: string | null;
  suggestion: { status: 'not_called' | 'failed' | 'suggested'; text: string | null };
  candidates: MaterialCandidate[];
}

export interface MaterialCompareRequest {
  goalName: string;
  goalDate: string;
  currentLevel: string;
  dailyMinutes: number;
  completionCriterion: string;
  planId: string | null;
  documentIds: string[];
  links: string[];
}

export function compareMaterials(body: MaterialCompareRequest): Promise<MaterialComparisonResponse> {
  return apiRequest<MaterialComparisonResponse>('/api/materials/compare', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function selectMaterial(
  comparisonId: string,
  body: {
    candidateId: string;
    goalName: string;
    goalDate: string;
    currentLevel: string;
    dailyMinutes: number;
    completionCriterion: string;
  },
): Promise<MaterialComparisonResponse> {
  return apiRequest<MaterialComparisonResponse>(
    `/api/materials/comparisons/${encodeURIComponent(comparisonId)}/select`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}
