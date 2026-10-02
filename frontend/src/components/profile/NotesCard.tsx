import { NotebookPen, Plus } from 'lucide-react';
import CardShell from './CardShell';
import { CardEmpty, CardError, CardLoading } from './states';
import { useAsync } from './useAsync';
import { fetchNotes } from '@/lib/profileStudyApi';

export interface NotesCardProps {
  onAction: (message: string) => void;
}

/** 笔记卡片：笔记总数、最近笔记、新建笔记 / 查看全部入口（占位）。 */
function NotesCard({ onAction }: NotesCardProps) {
  const { data, loading, error } = useAsync(fetchNotes);

  return (
    <CardShell
      title="笔记"
      icon={<NotebookPen size={17} aria-hidden="true" />}
      action={
        <button
          type="button"
          onClick={() => onAction('新建笔记：功能开发中')}
          className="flex items-center gap-1 rounded-full bg-brandDark px-3 py-1 text-sm font-medium text-white transition hover:shadow-[0_0_20px_rgba(16,185,129,0.4)]"
        >
          <Plus size={14} aria-hidden="true" />
          新建
        </button>
      }
    >
      {loading ? (
        <CardLoading />
      ) : error ? (
        <CardError message={error} />
      ) : data && data.total > 0 ? (
        <div className="flex h-full flex-col">
          <p className="text-sm text-gray-500">
            共 <span className="font-medium text-brandDark">{data.total}</span> 条笔记
          </p>
          <ul className="mt-3 space-y-2">
            {data.recent.map((note) => (
              <li
                key={note.id}
                className="flex items-center justify-between rounded-2xl bg-bg px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-brandDark">{note.title}</p>
                  <p className="text-xs text-gray-400">
                    {note.course} · {note.updatedAt}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => onAction('查看全部笔记：功能开发中')}
            className="mt-4 self-start rounded-full bg-bg px-3.5 py-1.5 text-sm font-medium text-brandDark transition hover:bg-brandFaint"
          >
            查看全部
          </button>
        </div>
      ) : (
        <CardEmpty>还没有笔记，点击「新建」记录第一条</CardEmpty>
      )}
    </CardShell>
  );
}

export default NotesCard;
