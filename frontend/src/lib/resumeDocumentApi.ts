import { apiRequest } from '@/lib/httpClient';

interface ResumeDocumentResponse {
  status: string;
  document: { payload: string; updatedAt: string | null } | null;
}

export interface ResumeDocument {
  payload: string;
  updatedAt: string | null;
}

/** 读取当前登录用户保存在服务端的简历快照；从未保存过时返回 null。 */
export async function fetchResumeDocument(): Promise<ResumeDocument | null> {
  const response = await apiRequest<ResumeDocumentResponse>('/api/resume-documents');
  return response.document;
}

/** 覆盖保存简历快照（整份 localStorage 内容），返回服务端写入时间。 */
export async function saveResumeDocument(payload: string): Promise<ResumeDocument | null> {
  const response = await apiRequest<ResumeDocumentResponse>('/api/resume-documents', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  });
  return response.document;
}
