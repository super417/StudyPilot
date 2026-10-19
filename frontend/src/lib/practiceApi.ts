import { apiRequest } from './httpClient';

export interface PracticeSourceRef {
  docId: string;
  filename: string;
  chunkIndex: number;
  snippet: string;
  score?: number;
}

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
  /** 生成时检索命中；旧题 / 上传题为 null */
  sourceRefs?: PracticeSourceRef[] | null;
}

export interface PracticeListResponse {
  status: string;
  questions: PracticeQuestion[];
  review: PracticeQuestion[];
}

const PRACTICE_BOARD_KEY = 'studypilot.practiceBoard';
const PRACTICE_BOARD_EVENT = 'studypilot:practice-board';

/** 切到习题本之前调用。页面还没挂载时先记下「今日练习」等意图，挂载时取走。 */
export function requestPracticeBoard(tab: 'today' | 'review' = 'today') {
  sessionStorage.setItem(PRACTICE_BOARD_KEY, tab);
  window.dispatchEvent(new Event(PRACTICE_BOARD_EVENT));
}

export function takePracticeBoard(): 'today' | 'review' | null {
  const value = sessionStorage.getItem(PRACTICE_BOARD_KEY);
  sessionStorage.removeItem(PRACTICE_BOARD_KEY);
  return value === 'today' || value === 'review' ? value : null;
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

/** 聊天题存入今日练习（pending，绑定今日 DailyTask；不写掌握度证据） */
export function savePracticeFromChat(input: {
  question: string;
  answer: string;
  explanation?: string;
  subject?: string;
  sourceRefs?: PracticeSourceRef[] | null;
}): Promise<{ status: string; question: PracticeQuestion }> {
  return apiRequest('/api/practice/from-chat', {
    method: 'POST',
    body: JSON.stringify({
      question: input.question,
      answer: input.answer,
      explanation: input.explanation ?? '',
      subject: input.subject ?? '',
      sourceRefs: input.sourceRefs ?? null,
    }),
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

export interface ExplanationReview {
  covered: string[];
  missing: string[];
  wrong: string[];
}

export interface PracticeExplainResponse {
  status: string;
  result: 'correct' | 'partial' | 'wrong' | 'insufficient';
  reason: string | null;
  evidence?: {
    id: string;
    knowledgePoint: string | null;
    evidenceType: string;
    sourceRef: string | null;
  };
  explanationReview?: ExplanationReview;
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

export function explainPractice(
  id: string,
  answerText: string,
): Promise<PracticeExplainResponse> {
  return apiRequest(`/api/practice/${id}/explain`, {
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
