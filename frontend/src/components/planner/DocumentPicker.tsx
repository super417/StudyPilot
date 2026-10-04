import { useEffect, useRef, useState } from 'react';
import { useDocumentsStore, makeSessionDoc } from '@/store/documentsStore';
import { DocumentsApiError, deleteDocument, fileTypeFromName, uploadDocument } from '@/lib/documentsApi';

/**
 * 考研资料多选（服务端清单水合；未就绪禁选）。
 * 可在表单内直接上传，成功后自动勾选为规划依据。
 */
function DocumentPicker() {
  const documents = useDocumentsStore((s) => s.documents);
  const selectedIds = useDocumentsStore((s) => s.selectedIds);
  const toggleSelect = useDocumentsStore((s) => s.toggleSelect);
  const hydrateFromServer = useDocumentsStore((s) => s.hydrateFromServer);
  const hydrated = useDocumentsStore((s) => s.hydrated);
  const hydrating = useDocumentsStore((s) => s.hydrating);
  const uploading = useDocumentsStore((s) => s.uploading);
  const addUploaded = useDocumentsStore((s) => s.addUploaded);
  const removeDocument = useDocumentsStore((s) => s.removeDocument);
  const setUploading = useDocumentsStore((s) => s.setUploading);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated && !hydrating) {
      void hydrateFromServer();
    }
  }, [hydrated, hydrating, hydrateFromServer]);

  const handleFile = async (file: File | undefined) => {
    if (!file || uploading) return;
    const fileType = fileTypeFromName(file.name);
    if (!fileType) {
      setError('仅支持 PDF、DOCX、TXT、Markdown');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const result = await uploadDocument(file);
      addUploaded(makeSessionDoc(result.docId, file.name, fileType, result.chunks));
      if (result.chunks > 0) toggleSelect(result.docId);
      else setError('文件已上传，但没有切出可用文字，这次规划不会用它。');
    } catch (err) {
      setError(err instanceof DocumentsApiError ? err.message : '上传失败，请稍后重试');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDelete = async (docId: string) => {
    if (deletingId) return;
    setDeletingId(docId);
    setError(null);
    try {
      await deleteDocument(docId);
      removeDocument(docId);
    } catch (err) {
      setError(err instanceof DocumentsApiError ? err.message : '删除失败，请稍后重试');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-1.5">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="w-full rounded-xl border border-dashed border-brand/40 bg-white/70 px-3 py-2 text-xs text-brandDark disabled:opacity-60"
      >
        {uploading ? '正在解析并切块…' : '上传讲义（PDF / DOCX / TXT / MD）'}
      </button>
      {error ? <p className="text-[11px] text-dangerText">{error}</p> : null}

      {hydrating && documents.length === 0 ? (
        <p className="rounded-xl bg-bg px-3 py-2 text-xs text-gray-500">正在加载已上传资料…</p>
      ) : null}

      {!hydrating && documents.length === 0 ? (
        <p className="rounded-xl bg-bg px-3 py-2 text-xs text-gray-500">
          还没有资料。上传后会自动勾选，作为这次规划的依据。
        </p>
      ) : null}

      {documents.length > 0 ? (
        <ul className="max-h-36 space-y-1.5 overflow-y-auto rounded-xl border border-brandFaint bg-white/80 p-2">
          {documents.map((doc) => {
            const checked = selectedIds.includes(doc.docId);
            const disabled = !doc.ready;
            return (
              <li key={doc.docId}>
                <label
                  className={`flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-xs ${
                    disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-brandFaint/60'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleSelect(doc.docId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-brandDark">{doc.filename}</span>
                    <span className="text-gray-400">
                      {doc.fileType.toUpperCase()}
                      {disabled ? ' · 尚未就绪' : ` · ${doc.chunks} 块`}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={deletingId === doc.docId}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void handleDelete(doc.docId);
                    }}
                    className="shrink-0 text-[11px] text-dangerText hover:underline disabled:opacity-60"
                  >
                    {deletingId === doc.docId ? '删除中…' : '删除'}
                  </button>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export default DocumentPicker;
