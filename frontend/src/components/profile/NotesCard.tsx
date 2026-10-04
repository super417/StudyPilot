import { useCallback, useEffect, useState } from 'react';
import { NotebookPen, Plus } from 'lucide-react';
import CardShell from './CardShell';
import Modal from './Modal';
import { CardEmpty, CardError, CardLoading } from './states';
import { ApiError } from '@/lib/httpClient';
import {
  createNote,
  deleteNote,
  listNotes,
  updateNote,
  type NoteRecord,
} from '@/lib/notesApi';
import { fetchCourseOverview } from '@/lib/coursesApi';

export interface NotesCardProps {
  onAction: (message: string) => void;
}

const EMPTY_DRAFT = { title: '', subject: '', body: '' };

function relativeAt(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  return iso.slice(0, 10);
}

/** 笔记：列表、新建、编辑、删除都走 /api/notes。 */
function NotesCard({ onAction }: NotesCardProps) {
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<string[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listNotes();
      setNotes(res.notes ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '笔记加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void fetchCourseOverview()
      .then((overview) => setSubjects(overview.courses.map((course) => course.name)))
      .catch(() => undefined);
  }, [editorOpen]);

  const openCreate = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setFormError(null);
    setEditorOpen(true);
  };

  const openEdit = (note: NoteRecord) => {
    setEditingId(note.id);
    setDraft({ title: note.title, subject: note.subject, body: note.body });
    setFormError(null);
    setEditorOpen(true);
  };

  const save = async () => {
    const title = draft.title.trim();
    if (!title) {
      setFormError('请填写标题');
      return;
    }
    setSaving(true);
    setFormError(null);
    const input = {
      title,
      subject: draft.subject.trim(),
      body: draft.body.trim(),
    };
    try {
      if (editingId) {
        await updateNote(editingId, input);
        onAction('笔记已更新');
      } else {
        await createNote(input);
        onAction('已记下一条笔记');
      }
      setEditorOpen(false);
      await reload();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (note: NoteRecord) => {
    if (saving) return;
    setSaving(true);
    try {
      await deleteNote(note.id);
      onAction(`已删除「${note.title}」`);
      if (editingId === note.id) setEditorOpen(false);
      await reload();
    } catch (e) {
      onAction(e instanceof ApiError ? e.message : '删除失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const recent = notes.slice(0, 3);

  return (
    <>
      <CardShell
        title="笔记"
        icon={<NotebookPen size={17} aria-hidden="true" />}
        action={
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-1 rounded-full bg-brandDark px-3 py-1 text-sm font-medium text-white transition hover:shadow-[0_0_20px_rgba(16,185,129,0.4)]"
          >
            <Plus size={14} aria-hidden="true" />
            新建
          </button>
        }
      >
        {loading && notes.length === 0 ? (
          <CardLoading />
        ) : error ? (
          <CardError message={error} onRetry={() => void reload()} />
        ) : notes.length > 0 ? (
          <div className="flex h-full flex-col">
            <p className="text-sm text-gray-500">
              共 <span className="font-medium text-brandDark">{notes.length}</span> 条笔记
            </p>
            <ul className="mt-3 space-y-2">
              {recent.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => openEdit(note)}
                    className="w-full rounded-2xl bg-bg px-4 py-2.5 text-left hover:bg-brandFaint/60"
                  >
                    <p className="truncate text-sm font-medium text-brandDark">{note.title}</p>
                    <p className="text-xs text-gray-400">
                      {note.subject || '未分科目'} · {relativeAt(note.updatedAt)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setListOpen(true)}
              className="mt-4 self-start rounded-full bg-bg px-3.5 py-1.5 text-sm font-medium text-brandDark transition hover:bg-brandFaint"
            >
              查看全部
            </button>
          </div>
        ) : (
          <CardEmpty>还没有笔记，点击「新建」记录第一条</CardEmpty>
        )}
      </CardShell>

      <Modal open={listOpen} title="全部笔记" onClose={() => setListOpen(false)}>
        <ul className="max-h-80 space-y-2 overflow-y-auto">
          {notes.map((note) => (
            <li key={note.id} className="flex items-start gap-2 rounded-2xl bg-bg px-3 py-2">
              <button
                type="button"
                onClick={() => {
                  setListOpen(false);
                  openEdit(note);
                }}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-medium text-brandDark">{note.title}</p>
                <p className="text-xs text-gray-400">
                  {note.subject || '未分科目'} · {relativeAt(note.updatedAt)}
                </p>
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void remove(note)}
                className="shrink-0 text-[11px] text-dangerText hover:underline disabled:opacity-60"
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      </Modal>

      <Modal
        open={editorOpen}
        title={editingId ? '编辑笔记' : '新建笔记'}
        onClose={() => setEditorOpen(false)}
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="block text-sm text-brandDark">
            标题
            <input
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              className="mt-1 w-full rounded-full border border-brandFaint bg-white px-3.5 py-2 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="block text-sm text-brandDark">
            科目
            {subjects.length > 0 ? (
              <select
                value={draft.subject}
                onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
                className="mt-1 w-full rounded-full border border-brandFaint bg-white px-3.5 py-2 text-sm outline-none focus:border-brand"
              >
                <option value="">未分科目</option>
                {draft.subject && !subjects.includes(draft.subject) ? (
                  <option value={draft.subject}>{draft.subject}</option>
                ) : null}
                {subjects.map((subject) => (
                  <option key={subject} value={subject}>
                    {subject}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={draft.subject}
                onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
                placeholder="先在课程管理里添加科目"
                className="mt-1 w-full rounded-full border border-brandFaint bg-white px-3.5 py-2 text-sm outline-none focus:border-brand"
              />
            )}
          </label>
          <label className="block text-sm text-brandDark">
            内容
            <textarea
              rows={5}
              value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              className="mt-1 w-full resize-none rounded-2xl border border-brandFaint bg-white px-3.5 py-2 text-sm outline-none focus:border-brand"
            />
          </label>
          {formError ? <p className="text-xs text-dangerText">{formError}</p> : null}
          <div className="flex justify-end gap-2">
            {editingId ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  const current = notes.find((note) => note.id === editingId);
                  if (current) void remove(current);
                }}
                className="mr-auto text-sm text-dangerText hover:underline disabled:opacity-60"
              >
                删除
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              className="rounded-full bg-bg px-4 py-2 text-sm font-medium text-brandDark"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn-pill px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export default NotesCard;
