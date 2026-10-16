import { apiRequest } from './httpClient';

export interface PracticeQuestion {
  id: string;
  source: 'generated' | 'uploaded';
  subject: string;
  question: string;
  answer: string;
  explanation: string;
  status: 'pending' | 'correct' | 'wrong';
  createdAt: string;
  sourceTaskId?: string | null;
  sourceMistakeId?: string | null;
}

export interface PracticeListResponse {
  status: string;
  questions: PracticeQuestion[];
  review: PracticeQuestion[];
}

export function listPractice(date: string): Promise<PracticeListResponse> {
  return apiRequest<PracticeListResponse>(`/api/practice?date=${encodeURIComponent(date)}`);
}

export function generatePractice(date: string): Promise<{ status: string; questions: PracticeQuestion[] }> {
  return apiRequest('/api/practice/generate', {
    method: 'POST',
    body: JSON.stringify({ date }),
  });
}

export function generateReinforceRetest(
  phaseId: string,
): Promise<{ status: string; questions: PracticeQuestion[] }> {
  return apiRequest('/api/practice/reinforce-retest', {
    method: 'POST',
    body: JSON.stringify({ phaseId }),
  });
}

export function createPractice(input: {
  question: string;
  answer?: string;
  explanation?: string;
  subject?: string;
}): Promise<{ status: string; question: PracticeQuestion }> {
  return apiRequest('/api/practice', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface PracticeGradeResponse {
  status: string;
  result: 'correct' | 'partial' | 'wrong';
  reason: string | null;
  evidence: {
    id: string;
    knowledgePoint: string | null;
    evidenceType: string;
    sourceRef: string | null;
  };
}

export function gradePractice(
  id: string,
  answerText: string,
): Promise<PracticeGradeResponse> {
  return apiRequest(`/api/practice/${id}/grade`, {
    method: 'POST',
    body: JSON.stringify({ answerText }),
  });
}

export function setPracticeStatus(
  id: string,
  status: PracticeQuestion['status'],
  myAnswer?: string,
): Promise<{ status: string; question: PracticeQuestion }> {
  return apiRequest(`/api/practice/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, myAnswer }),
  });
}

export function deletePractice(id: string): Promise<{ status: string; deletedId: string }> {
  return apiRequest(`/api/practice/${id}`, { method: 'DELETE' });
}
