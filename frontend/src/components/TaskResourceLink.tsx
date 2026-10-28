import { ExternalLink } from 'lucide-react';
import type { DailyTask } from '@/mocks/types';
import { isConcreteResourceUrl } from '@/lib/resourceLinks';

/**
 * TaskResourceLink — 每日任务附带的公开学习链接。
 *
 * 后端校验新链接；此处也过滤旧任务中保存的平台首页。
 */
function TaskResourceLink({ task }: { task: DailyTask }) {
  if (!isConcreteResourceUrl(task.resourceUrl)) return null;
  const location = [task.chapterTitle?.trim(), task.sectionTitle?.trim()].filter(Boolean).join(' · ');

  return (
    <div className="mt-1">
      <a
        href={task.resourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="inline-flex items-center gap-1 text-xs font-medium text-brandDark underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
      >
        <ExternalLink size={12} aria-hidden="true" />
        打开学习资源
      </a>
      {location && <span className="ml-2 text-xs text-slate-600">{location}</span>}
    </div>
  );
}

export default TaskResourceLink;
