import { apiRequest, ApiError } from './httpClient';
import type { DocumentFileType } from '@/mocks/types';

export { ApiError as DocumentsApiError };

export interface UploadDocumentResult {
  status: string;
  docId: string;
  chunks: number;
}

const EXT_MAP: Record<string, DocumentFileType> = {
  pdf: 'pdf',
  docx: 'docx',
  txt: 'txt',
  md: 'md',
};

export function fileTypeFromName(filename: string): DocumentFileType | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MAP[ext] ?? null;
}

/** POST /api/documents multipart field name: file */
export function uploadDocument(
  file: File,
  signal?: AbortSignal,
): Promise<UploadDocumentResult> {
  const form = new FormData();
  form.append('file', file);
  return apiRequest<UploadDocumentResult>('/api/documents', {
    method: 'POST',
    body: form,
    signal,
  });
}

export interface ListedDocument {
  docId: string;
  filename: string;
  fileType: DocumentFileType;
  chunks: number;
  ready: boolean;
  uploadedAt: string;
}

export interface ListDocumentsResponse {
  status: string;
  documents: ListedDocument[];
}

/** GET /api/documents — 当前用户已上传文档清单 */
export function listDocuments(signal?: AbortSignal): Promise<ListDocumentsResponse> {
  return apiRequest<ListDocumentsResponse>('/api/documents', { signal });
}
