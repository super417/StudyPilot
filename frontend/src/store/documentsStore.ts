/**
 * 用户文档清单：优先由 GET /api/documents 水合，上传成功后再追加。
 */
import { create } from 'zustand';
import type { DocumentFileType, UserDocument } from '@/mocks/types';
import { listDocuments, type ListedDocument } from '@/lib/documentsApi';

export interface SessionDocument extends UserDocument {
  chunks: number;
  uploadedAt: string;
}

interface DocumentsState {
  documents: SessionDocument[];
  selectedIds: string[];
  uploading: boolean;
  hydrating: boolean;
  hydrated: boolean;
  lastError: string | null;

  hydrateFromServer: () => Promise<void>;
  addUploaded: (doc: SessionDocument) => void;
  markSkipped: (docIds: string[]) => void;
  toggleSelect: (docId: string) => void;
  setSelectedIds: (ids: string[]) => void;
  getSelectedDocumentIds: () => string[];
  setUploading: (v: boolean) => void;
  setLastError: (msg: string | null) => void;
}

function fromListed(doc: ListedDocument): SessionDocument {
  return {
    docId: doc.docId,
    filename: doc.filename,
    fileType: doc.fileType,
    ready: doc.ready,
    chunks: doc.chunks,
    uploadedAt: doc.uploadedAt,
  };
}

export const useDocumentsStore = create<DocumentsState>((set, get) => ({
  documents: [],
  selectedIds: [],
  uploading: false,
  hydrating: false,
  hydrated: false,
  lastError: null,

  hydrateFromServer: async () => {
    if (get().hydrating) return;
    set({ hydrating: true });
    try {
      const res = await listDocuments();
      const documents = (res.documents ?? []).map(fromListed);
      set((state) => {
        const selectedIds = state.selectedIds.filter((id) =>
          documents.some((d) => d.docId === id && d.ready),
        );
        return {
          documents,
          selectedIds,
          hydrated: true,
          lastError: null,
        };
      });
    } catch {
      set({ hydrated: true });
    } finally {
      set({ hydrating: false });
    }
  },

  addUploaded: (doc) =>
    set((state) => {
      const without = state.documents.filter((d) => d.docId !== doc.docId);
      return {
        documents: [doc, ...without],
        lastError: null,
      };
    }),

  markSkipped: (docIds) =>
    set((state) => ({
      documents: state.documents.map((d) =>
        docIds.includes(d.docId) ? { ...d, ready: false } : d,
      ),
      selectedIds: state.selectedIds.filter((id) => !docIds.includes(id)),
    })),

  toggleSelect: (docId) =>
    set((state) => {
      const doc = state.documents.find((d) => d.docId === docId);
      if (!doc?.ready) return state;
      const has = state.selectedIds.includes(docId);
      return {
        selectedIds: has
          ? state.selectedIds.filter((id) => id !== docId)
          : [...state.selectedIds, docId],
      };
    }),

  setSelectedIds: (ids) => set({ selectedIds: ids }),

  getSelectedDocumentIds: () => {
    const { documents, selectedIds } = get();
    const ready = new Set(documents.filter((d) => d.ready).map((d) => d.docId));
    return selectedIds.filter((id) => ready.has(id));
  },

  setUploading: (v) => set({ uploading: v }),
  setLastError: (msg) => set({ lastError: msg }),
}));

export function makeSessionDoc(
  docId: string,
  filename: string,
  fileType: DocumentFileType,
  chunks: number,
): SessionDocument {
  return {
    docId,
    filename,
    fileType,
    ready: true,
    chunks,
    uploadedAt: new Date().toISOString(),
  };
}
