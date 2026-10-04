import { useCallback, useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import CardShell from './CardShell';
import Modal from './Modal';
import { CardEmpty, CardError, CardLoading } from './states';
import { ApiError } from '@/lib/httpClient';
import {
  createChapter,
  createCourse,
  deleteChapter,
  deleteCourse,
  fetchChapters,
  fetchCourseOverview,
  setChapterDone,
  updateCourse,
  type CourseChapter,
  type CourseOverview,
  type CourseRecord,
} from '@/lib/coursesApi';

export interface CoursesCardProps {
  onAction: (message: string) => void;
}

function ChapterRows({
  chapters,
  disabled,
  onToggle,
  onRemove,
}: {
  chapters: CourseChapter[];
  disabled: boolean;
  onToggle: (chapter: CourseChapter) => void;
  onRemove?: (chapter: CourseChapter) => void;
}) {
  if (chapters.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {chapters.map((chapter) => (
        <li key={chapter.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={chapter.done}
            disabled={disabled}
            aria-label={`${chapter.done ? '取消完成' : '完成'} ${chapter.title}`}
            onChange={() => onToggle(chapter)}
            className="h-4 w-4 shrink-0 accent-brand"
          />
          <a
            href={chapter.url}
            target="_blank"
            rel="noreferrer"
            className={`min-w-0 flex-1 truncate text-sm hover:underline ${
              chapter.done ? 'text-gray-400 line-through' : 'text-brandDark'
            }`}
          >
            {chapter.title}
          </a>
          {onRemove ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(chapter)}
              className="shrink-0 text-[11px] text-dangerText hover:underline disabled:opacity-60"
            >
              删除
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function CoursesCard({ onAction }: CoursesCardProps) {
  const [overview, setOverview] = useState<CourseOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<CourseRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [cardChapters, setCardChapters] = useState<CourseChapter[]>([]);
  const [editChapters, setEditChapters] = useState<CourseChapter[]>([]);
  const [chapterTitle, setChapterTitle] = useState('');
  const [chapterUrl, setChapterUrl] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await fetchCourseOverview());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '课程加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const recentId = overview?.courses[0]?.id ?? '';

  useEffect(() => {
    if (!recentId) {
      setCardChapters([]);
      return;
    }
    let cancel = false;
    void fetchChapters(recentId)
      .then((rows) => {
        if (!cancel) setCardChapters(rows);
      })
      .catch(() => {
        if (!cancel) setCardChapters([]);
      });
    return () => {
      cancel = true;
    };
  }, [recentId]);

  useEffect(() => {
    if (!editing) {
      setEditChapters([]);
      return;
    }
    let cancel = false;
    void fetchChapters(editing.id)
      .then((rows) => {
        if (!cancel) setEditChapters(rows);
      })
      .catch(() => {
        if (!cancel) setEditChapters([]);
      });
    return () => {
      cancel = true;
    };
  }, [editing]);

  const apply = (next: CourseOverview) => {
    setOverview(next);
    setName('');
    setEditing(null);
    setFormError(null);
  };

  const remember = (courseId: string, rows: CourseChapter[]) => {
    if (courseId === recentId) setCardChapters(rows);
    if (editing?.id === courseId) setEditChapters(rows);
  };

  const save = async () => {
    const cleaned = name.trim();
    if (!cleaned) {
      setFormError('请填写课程名称');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const next = editing
        ? await updateCourse(editing.id, { name: cleaned, status: editing.status })
        : await createCourse(cleaned);
      apply(next);
      onAction(editing ? '课程已更新' : '已添加课程');
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (course: CourseRecord) => {
    setSaving(true);
    try {
      const next = await updateCourse(course.id, {
        name: course.name,
        status: course.status === 'active' ? 'paused' : 'active',
      });
      apply(next);
    } catch (e) {
      onAction(e instanceof ApiError ? e.message : '更新失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (course: CourseRecord) => {
    setSaving(true);
    try {
      apply(await deleteCourse(course.id));
      onAction(`已删除「${course.name}」`);
    } catch (e) {
      onAction(e instanceof ApiError ? e.message : '删除失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const addChapter = async () => {
    if (!editing) return;
    const title = chapterTitle.trim();
    const url = chapterUrl.trim();
    if (!title || !url) {
      setFormError('请填写这一节，以及课程或视频的网页地址');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      remember(editing.id, await createChapter(editing.id, { title, url }));
      setChapterTitle('');
      setChapterUrl('');
      onAction('已添加章节链接');
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : '添加失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const toggleChapter = async (courseId: string, chapter: CourseChapter) => {
    setSaving(true);
    try {
      remember(courseId, await setChapterDone(courseId, chapter.id, !chapter.done));
    } catch (e) {
      onAction(e instanceof ApiError ? e.message : '更新失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const removeChapter = async (chapter: CourseChapter) => {
    if (!editing) return;
    setSaving(true);
    try {
      remember(editing.id, await deleteChapter(editing.id, chapter.id));
    } catch (e) {
      onAction(e instanceof ApiError ? e.message : '删除失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const courses = overview?.courses ?? [];

  return (
    <>
      <CardShell
        title="课程管理"
        icon={<BookOpen size={17} aria-hidden="true" />}
        action={
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full px-2.5 py-1 text-sm text-brand transition hover:bg-brandFaint"
          >
            管理课程
          </button>
        }
      >
        {loading && !overview ? (
          <CardLoading />
        ) : error ? (
          <CardError message={error} onRetry={() => void reload()} />
        ) : courses.length > 0 && overview ? (
          <div className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-4xl font-bold leading-none text-brandDark">
                {overview.activeCount}
              </span>
              <span className="text-sm text-gray-500">门在学课程</span>
            </div>
            <div className="rounded-2xl bg-bg px-4 py-3">
              <p className="text-xs text-gray-400">最近课程</p>
              <p className="text-sm font-medium text-brandDark">{overview.recentCourse}</p>
            </div>
            <div className="rounded-2xl bg-bg px-4 py-3">
              <p className="text-xs text-gray-400">下一个任务</p>
              <p className="text-sm font-medium text-brandDark">{overview.nextTask}</p>
            </div>
            <div className="rounded-2xl bg-bg px-4 py-3">
              <p className="text-xs text-gray-400">学习章节</p>
              {cardChapters.length > 0 ? (
                <div className="mt-2">
                  <ChapterRows
                    chapters={cardChapters}
                    disabled={saving}
                    onToggle={(chapter) => void toggleChapter(recentId, chapter)}
                  />
                </div>
              ) : (
                <p className="mt-1 text-sm text-gray-500">
                  没有书、或想配视频时，在「管理课程」里给这一门贴上网页，学完打勾。
                </p>
              )}
            </div>
          </div>
        ) : (
          <CardEmpty>还没有课程，点击「管理课程」添加</CardEmpty>
        )}
      </CardShell>

      <Modal open={open} title="管理课程" onClose={() => setOpen(false)}>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="block text-sm text-brandDark">
            {editing ? '修改名称' : '新课程'}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="如：高等数学"
              className="mt-1 w-full rounded-full border border-brandFaint bg-white px-3.5 py-2 text-sm outline-none focus:border-brand"
            />
          </label>
          {formError && !editing ? <p className="text-xs text-dangerText">{formError}</p> : null}
          <button
            type="submit"
            disabled={saving}
            className="btn-pill px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {saving ? '保存中…' : editing ? '保存修改' : '添加'}
          </button>
        </form>
        <ul className="mt-4 max-h-40 space-y-2 overflow-y-auto">
          {courses.map((course) => (
            <li key={course.id} className="flex items-center gap-2 rounded-2xl bg-bg px-3 py-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(course);
                  setName(course.name);
                  setFormError(null);
                  setChapterTitle('');
                  setChapterUrl('');
                }}
                className="min-w-0 flex-1 truncate text-left text-sm font-medium text-brandDark"
              >
                {course.name}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void toggle(course)}
                className="shrink-0 text-xs text-brandDark hover:underline disabled:opacity-60"
              >
                {course.status === 'active' ? '在学' : '暂停'}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void remove(course)}
                className="shrink-0 text-[11px] text-dangerText hover:underline disabled:opacity-60"
              >
                删除
              </button>
            </li>
          ))}
        </ul>
        {editing ? (
          <form
            className="mt-4 space-y-2 border-t border-brandFaint pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void addChapter();
            }}
          >
            <p className="text-sm font-medium text-brandDark">「{editing.name}」的章节</p>
            <p className="text-xs text-gray-400">
              没有对应的书，或想配视频，把那一节和网页地址填在这里。点标题打开，学完打勾。
            </p>
            <input
              value={chapterTitle}
              onChange={(event) => setChapterTitle(event.target.value)}
              placeholder="这一节，如：极限 · 宋浩视频"
              className="w-full rounded-full border border-brandFaint bg-white px-3.5 py-2 text-sm outline-none focus:border-brand"
            />
            <input
              value={chapterUrl}
              onChange={(event) => setChapterUrl(event.target.value)}
              placeholder="https:// 课程或视频网页"
              className="w-full rounded-full border border-brandFaint bg-white px-3.5 py-2 text-sm outline-none focus:border-brand"
            />
            {formError ? <p className="text-xs text-dangerText">{formError}</p> : null}
            <button
              type="submit"
              disabled={saving}
              className="btn-pill px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              添加章节
            </button>
            <ChapterRows
              chapters={editChapters}
              disabled={saving}
              onToggle={(chapter) => void toggleChapter(editing.id, chapter)}
              onRemove={(chapter) => void removeChapter(chapter)}
            />
          </form>
        ) : (
          <p className="mt-3 text-xs text-gray-400">点一门课，给它加章节链接</p>
        )}
      </Modal>
    </>
  );
}

export default CoursesCard;
