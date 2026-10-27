import { apiRequest, ApiError, getApiBaseUrl, type ErrorPayload } from './httpClient';
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

/** 后端 `document_service.MAX_FILE_BYTES` 的前端镜像，用于上传前就拦住 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** 允许的扩展名（与 `ALLOWED_FILE_TYPES` 一致），给 <input accept> 用 */
export const ACCEPT_ATTR = '.pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown';

/**
 * 带进度的上传。
 *
 * fetch 至今没有暴露上传进度（`Request.upload` 还只是提案），想要真实的
 * 百分比只能走 XHR —— 但**错误解析仍然沿用 apiRequest 那一套**，所以这里
 * 手写一遍 `parseError` 的字段优先级，别让上传失败时的报错文案和别的接口不一致。
 *
 * 注意：`upload.onprogress` 到 1 只代表字节发完了，服务端还在解析和切块，
 * 调用方要等 Promise resolve 才算真的完成。
 */
export function uploadDocumentWithProgress(
  file: File,
  onProgress: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<UploadDocumentResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${getApiBaseUrl()}/api/documents`);
    xhr.withCredentials = true;
    xhr.responseType = 'json';

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    };

    xhr.onerror = () =>
      reject(new ApiError(0, 'NETWORK_ERROR', '无法连接服务器，请检查网络后重试'));
    xhr.onabort = () => reject(new ApiError(0, 'ABORTED', '上传已取消'));

    xhr.onload = () => {
      const payload = xhr.response as (UploadDocumentResult & ErrorPayload) | null;
      const failed =
        xhr.status < 200 ||
        xhr.status >= 300 ||
        (payload !== null && 'status' in payload && payload.status === 'error');
      if (failed) {
        const detail = payload?.detail;
        const code =
          payload?.code ??
          payload?.error ??
          (typeof detail === 'object' ? detail?.code : undefined) ??
          'REQUEST_FAILED';
        const message =
          payload?.message ??
          (typeof detail === 'string' ? detail : detail?.message) ??
          '上传失败，请稍后重试';
        reject(new ApiError(xhr.status, code, message, payload?.retryAfterSeconds));
        return;
      }
      if (payload === null) {
        reject(new ApiError(0, 'INVALID_RESPONSE', '服务器响应异常，请稍后重试'));
        return;
      }
      resolve(payload);
    };

    if (signal) {
      if (signal.aborted) {
        reject(new ApiError(0, 'ABORTED', '上传已取消'));
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
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

/** DELETE /api/documents/{docId} — 删除该文档全部切块 */
export function deleteDocument(
  docId: string,
  signal?: AbortSignal,
): Promise<{ status: string; docId: string; removedChunks: number }> {
  return apiRequest(`/api/documents/${encodeURIComponent(docId)}`, {
    method: 'DELETE',
    signal,
  });
}
