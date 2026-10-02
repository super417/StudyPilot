import { useEffect } from 'react';
import { useDocumentsStore } from '@/store/documentsStore';

/**
 * 考研资料多选（服务端清单水合；未就绪禁选）。
 * 提交时由父组件经 getSelectedDocumentIds() 取 documentIds。
 */
function DocumentPicker() {
  const documents = useDocumentsStore((s) => s.documents);
  const selectedIds = useDocumentsStore((s) => s.selectedIds);
  const toggleSelect = useDocumentsStore((s) => s.toggleSelect);
  const hydrateFromServer = useDocumentsStore((s) => s.hydrateFromServer);
  const hydrated = useDocumentsStore((s) => s.hydrated);
  const hydrating = useDocumentsStore((s) => s.hydrating);

  useEffect(() => {
    if (!hydrated && !hydrating) {
      void hydrateFromServer();
    }
  }, [hydrated, hydrating, hydrateFromServer]);

  if (hydrating && documents.length === 0) {
    return (
      <p className="rounded-xl bg-bg px-3 py-2 text-xs text-gray-500">
        正在加载已上传资料…
      </p>
    );
  }

  if (documents.length === 0) {
    return (
      <p className="rounded-xl bg-bg px-3 py-2 text-xs text-gray-500">
        尚无已上传资料。可先在个人中心「学习资料」上传考研讲义 / 笔记（PDF、DOCX、TXT、Markdown）。
      </p>
    );
  }

  return (
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
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export default DocumentPicker;
