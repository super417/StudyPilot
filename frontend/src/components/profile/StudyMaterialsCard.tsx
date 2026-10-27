import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import CardShell from './CardShell';
import UploadDropzone from './UploadDropzone';
import { CardEmpty, CardError } from './states';
import {
  DocumentsApiError,
  deleteDocument,
  fileTypeFromName,
  uploadDocumentWithProgress,
} from '@/lib/documentsApi';
import { makeSessionDoc, useDocumentsStore } from '@/store/documentsStore';

export interface StudyMaterialsCardProps {
  onAction: (message: string) => void;
}

/** 学习资料：GET 水合 + POST 上传 + DELETE 删除。 */
function StudyMaterialsCard({ onAction }: StudyMaterialsCardProps) {
  const documents = useDocumentsStore((s) => s.documents);
  const hydrating = useDocumentsStore((s) => s.hydrating);
  const hydrated = useDocumentsStore((s) => s.hydrated);
  const lastError = useDocumentsStore((s) => s.lastError);
  const hydrateFromServer = useDocumentsStore((s) => s.hydrateFromServer);
  const addUploaded = useDocumentsStore((s) => s.addUploaded);
  const removeDocument = useDocumentsStore((s) => s.removeDocument);
  const setUploading = useDocumentsStore((s) => s.setUploading);
  const setLastError = useDocumentsStore((s) => s.setLastError);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated && !hydrating) {
      void hydrateFromServer();
    }
  }, [hydrated, hydrating, hydrateFromServer]);

  const recent = documents[0];

  /** 真正的上传：进度由 XHR 的 upload.onprogress 推上来 */
  const handleUpload = async (file: File, onProgress: (ratio: number) => void) => {
    const fileType = fileTypeFromName(file.name);
    if (!fileType) {
      return { ok: false, message: '仅支持 PDF / DOCX / TXT / Markdown' };
    }

    setUploading(true);
    setLastError(null);
    try {
      const result = await uploadDocumentWithProgress(file, onProgress);
      addUploaded(makeSessionDoc(result.docId, file.name, fileType, result.chunks));
      onAction(
        result.chunks > 0
          ? `已上传「${file.name}」（${result.chunks} 块），可在助手中选为规划依据`
          : `已上传「${file.name}」，但没有切出可用文字，规划时不会使用`,
      );
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof DocumentsApiError ? error.message : '上传失败，请稍后重试';
      setLastError(message);
      onAction(`上传失败：${message}`);
      return { ok: false, message };
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docId: string, filename: string) => {
    if (deletingId) return;
    setDeletingId(docId);
    setLastError(null);
    try {
      await deleteDocument(docId);
      removeDocument(docId);
      onAction(`已删除「${filename}」`);
    } catch (error) {
      const message =
        error instanceof DocumentsApiError ? error.message : '删除失败，请稍后重试';
      setLastError(message);
      onAction(`删除失败：${message}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <CardShell title="学习资料" icon={<FolderOpen size={17} aria-hidden="true" />}>
      {lastError ? <CardError message={lastError} /> : null}

      {hydrating && documents.length === 0 ? (
        <p className="text-sm text-gray-500">正在加载资料…</p>
      ) : documents.length > 0 ? (
        <div className="flex h-full flex-col">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-4xl font-bold leading-none text-brandDark">
              {documents.length}
            </span>
            <span className="text-sm text-gray-500">份资料</span>
          </div>
          {recent ? (
            <p className="mt-3 text-sm text-gray-500">
              最近添加：<span className="text-brandDark">{recent.filename}</span>
              <span className="ml-1 text-gray-400">· {recent.chunks} 块</span>
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {[...new Set(documents.map((d) => d.fileType.toUpperCase()))].map((c) => (
              <span
                key={c}
                className="rounded-full bg-brandFaint px-2.5 py-1 text-xs font-medium text-brandDark"
              >
                {c}
              </span>
            ))}
          </div>
          <ul className="mt-3 max-h-28 space-y-1 overflow-y-auto text-xs text-gray-600">
            {documents.map((d) => (
              <li key={d.docId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {d.filename}
                  {!d.ready ? '（尚未就绪）' : ''}
                </span>
                <button
                  type="button"
                  disabled={deletingId === d.docId}
                  onClick={() => void handleDelete(d.docId, d.filename)}
                  className="shrink-0 text-[11px] text-dangerText hover:underline disabled:opacity-60"
                >
                  {deletingId === d.docId ? '删除中…' : '删除'}
                </button>
              </li>
            ))}
          </ul>
          {/* 原来这里是一个「上传资料」药丸按钮，换成了 Bencho 的拖放盒 */}
          <div className="mt-5">
            <UploadDropzone onUpload={handleUpload} />
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col">
          <CardEmpty>还没有资料，上传讲义或笔记开始积累吧</CardEmpty>
          <div className="mt-4">
            <UploadDropzone onUpload={handleUpload} />
          </div>
        </div>
      )}
    </CardShell>
  );
}

export default StudyMaterialsCard;
