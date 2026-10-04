import { useCallback, useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import CardShell from './CardShell';
import Modal from './Modal';
import { CardEmpty, CardError, CardLoading } from './states';
import { ApiError } from '@/lib/httpClient';
import {
  createCourse,
  deleteCourse,
  fetchCourseOverview,
  updateCourse,
  type CourseOverview,
  type CourseRecord,
} from '@/lib/coursesApi';

export interface CoursesCardProps {
  onAction: (message: string) => void;
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

  const apply = (next: CourseOverview) => {
    setOverview(next);
    setName('');
    setEditing(null);
    setFormError(null);
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
          {formError ? <p className="text-xs text-dangerText">{formError}</p> : null}
          <button
            type="submit"
            disabled={saving}
            className="btn-pill px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {saving ? '保存中…' : editing ? '保存修改' : '添加'}
          </button>
        </form>
        <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto">
          {courses.map((course) => (
            <li key={course.id} className="flex items-center gap-2 rounded-2xl bg-bg px-3 py-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(course);
                  setName(course.name);
                  setFormError(null);
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
      </Modal>
    </>
  );
}

export default CoursesCard;
