import { StarCrown } from '@/components/journey/glyphs';
import { dayFacts } from '@/journey/cheer';
import type { CheerResponse, JourneyDay, JourneyTask } from '@/journey/types';

export function CheerCard({ cheer, onClose }: { cheer: CheerResponse; onClose: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-24 z-40 flex justify-center px-4" data-cheer="open">
      <div className="journey-card pointer-events-auto max-w-sm px-4 py-3 text-sm font-semibold text-[#14532d]">
        <p>{cheer.text}</p>
        <button type="button" className="mt-2 text-xs font-bold text-[#0f766e]" onClick={onClose}>
          知道了
        </button>
      </div>
    </div>
  );
}

export function DayDrawer({
  day,
  planStart,
  tasks,
  cheer,
  compact,
  onClose,
  onPractice,
  onRoadmap,
}: {
  day: JourneyDay;
  planStart: string;
  tasks: JourneyTask[];
  cheer: CheerResponse | null;
  compact: boolean;
  onClose: () => void;
  onPractice: () => void;
  onRoadmap: () => void;
}) {
  const index = Math.round((new Date(`${day.date}T12:00:00`).getTime() - new Date(`${planStart}T12:00:00`).getTime()) / 86_400_000) + 1;
  const body = (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-black text-[#14532d]">{day.date.slice(5)}</p>
          <p className="text-xs text-[#3f6b4a]">计划第 {index} 天 · {day.state === 'today' ? '今天' : day.state === 'future' ? '还没到' : '已过去'}</p>
        </div>
        <button type="button" className="text-sm font-bold text-[#3f6b4a]" onClick={onClose}>
          关闭
        </button>
      </div>
      {day.stars !== null ? (
        <div className="mt-2">
          <StarCrown filled={day.stars} color={day.starColor} preview={false} compact={false} />
          <p className="text-sm font-semibold text-[#14532d]">
            完成 {day.done}/{day.total} · {dayFacts(day)}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-[#3f6b4a]">{day.state === 'future' ? `计划了 ${day.total} 项` : '这天没有任务'}</p>
      )}
      <ul className="mt-3 space-y-1 text-sm text-[#14532d]">
        {tasks.length === 0 ? <li>这一天没有任务条目。</li> : null}
        {tasks.map((task) => (
          <li key={task.id} className="flex justify-between gap-3 rounded-xl bg-white/70 px-3 py-2">
            <span>{task.description}</span>
            <span className="shrink-0 text-xs text-[#3f6b4a]">{task.status === 'done' ? '完成' : task.status === 'carried' ? '已顺延' : '待办'}</span>
          </li>
        ))}
      </ul>
      {cheer ? <p className="mt-3 text-sm font-semibold text-[#14532d]">{cheer.text}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {day.state === 'today' ? (
          <button type="button" className="journey-pill px-4 py-2 text-sm font-bold" onClick={onRoadmap}>
            去完成
          </button>
        ) : null}
        {day.tags.includes('boss') ? (
          <button type="button" className="journey-chip px-4 py-2 text-sm font-bold" onClick={onPractice}>
            去做练习
          </button>
        ) : null}
        {cheer?.suggestRoadmap ? (
          <button type="button" className="journey-chip px-4 py-2 text-sm font-bold" onClick={onRoadmap}>
            去 Roadmap 查看任务
          </button>
        ) : null}
      </div>
    </div>
  );
  if (compact) {
    return (
      <div className="absolute inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto p-4 pb-[max(16px,env(safe-area-inset-bottom))] journey-sheet" data-drawer="day">
        {body}
      </div>
    );
  }
  return (
    <div className="absolute bottom-24 right-4 z-40 max-h-[70vh] w-[min(360px,calc(100%-2rem))] overflow-y-auto p-4 journey-card" data-drawer="day">
      {body}
    </div>
  );
}
