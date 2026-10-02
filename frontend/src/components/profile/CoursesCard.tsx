import { BookOpen } from 'lucide-react';
import CardShell from './CardShell';
import { CardEmpty, CardError, CardLoading } from './states';
import { useAsync } from './useAsync';
import { fetchCourses } from '@/lib/profileStudyApi';

export interface CoursesCardProps {
  onAction: (message: string) => void;
}

/** 课程管理卡片：在学课程数、最近课程、下一个任务、管理课程入口（占位）。 */
function CoursesCard({ onAction }: CoursesCardProps) {
  const { data, loading, error } = useAsync(fetchCourses);

  return (
    <CardShell
      title="课程管理"
      icon={<BookOpen size={17} aria-hidden="true" />}
      action={
        <button
          type="button"
          onClick={() => onAction('管理课程：功能开发中')}
          className="rounded-full px-2.5 py-1 text-sm text-brand transition hover:bg-brandFaint"
        >
          管理课程
        </button>
      }
    >
      {loading ? (
        <CardLoading />
      ) : error ? (
        <CardError message={error} />
      ) : data && data.activeCount > 0 ? (
        <div className="space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-4xl font-bold leading-none text-brandDark">
              {data.activeCount}
            </span>
            <span className="text-sm text-gray-500">门在学课程</span>
          </div>
          <div className="rounded-2xl bg-bg px-4 py-3">
            <p className="text-xs text-gray-400">最近课程</p>
            <p className="text-sm font-medium text-brandDark">{data.recentCourse}</p>
          </div>
          <div className="rounded-2xl bg-bg px-4 py-3">
            <p className="text-xs text-gray-400">下一个任务</p>
            <p className="text-sm font-medium text-brandDark">{data.nextTask}</p>
          </div>
        </div>
      ) : (
        <CardEmpty>还没有课程，点击「管理课程」添加</CardEmpty>
      )}
    </CardShell>
  );
}

export default CoursesCard;
