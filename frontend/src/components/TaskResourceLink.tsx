import { ExternalLink } from 'lucide-react';
import type { DailyTask } from '@/mocks/types';

/**
 * TaskResourceLink — 每日任务附带的公开学习链接。
 *
 * 链接由后端按域名白名单（`services/resource_links.py`）校验后才入库，
 * 所以这里只负责展示，不做二次判断；没有链接时整块不渲染。
 */
function TaskResourceLink({ task }: { task: DailyTask }) {
  if (!task.resourceUrl) return null;

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
    </div>
  );
}

export default TaskResourceLink;
