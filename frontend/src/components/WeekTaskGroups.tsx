import { motion } from 'framer-motion';
import type { DailyTask } from '@/mocks/types';
import TaskResourceLink from './TaskResourceLink';

/**
 * WeekTaskGroups — Roadmap 页周任务详情（需求 5.4）
 *
 * 按 weekLabel（如 W01）分组展示每日任务。
 * 每个周分组显示：周标签 + 该组任务数 + 每条每日任务描述。
 * 分组以卡片呈现，组内任务项之间用极浅绿 brandFaint 1px 分割线。
 *
 * 动效：悬停时卡片向左上小幅浮动（x/y: -6），阴影朝相反的右下方加深偏移
 * （14px/14px 正偏移），形成「翘起/悬浮」的立体感；按下时轻微回弹（scale: 0.99）。
 * 弹簧过渡平滑克制，仅增强不改变 .card 的圆角/白底/内边距与内部内容。
 */

/** motion 版分组卡片，保留 .card 视觉与内部结构不变。 */
const MotionCard = motion.create('div');

export interface WeekTaskGroupsProps {
  /** 每日任务列表 */
  tasks: DailyTask[];
  /** 点击任务切换 pending↔done（可选） */
  onToggleStatus?: (task: DailyTask) => void;
}

interface WeekGroup {
  /** 周标签，如 W01 */
  weekLabel: string;
  /** 该周任务 */
  tasks: DailyTask[];
}

/** 按 weekLabel 分组，保持任务原有出现顺序，分组顺序按首次出现。 */
function groupByWeek(tasks: DailyTask[]): WeekGroup[] {
  const groups: WeekGroup[] = [];
  const index = new Map<string, WeekGroup>();

  for (const task of tasks) {
    let group = index.get(task.weekLabel);
    if (!group) {
      group = { weekLabel: task.weekLabel, tasks: [] };
      index.set(task.weekLabel, group);
      groups.push(group);
    }
    group.tasks.push(task);
  }

  return groups;
}

function WeekTaskGroups({ tasks, onToggleStatus }: WeekTaskGroupsProps) {
  const groups = groupByWeek(tasks);

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-brandDark sm:text-xl">周任务详情</h2>

      {groups.length === 0 ? (
        <div className="card p-8 text-sm text-gray-400">暂无每日任务</div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <MotionCard
              key={group.weekLabel}
              // 视口内渲染优化（需求 18.28）：周任务分组卡随规划周数增长可能很长，
              // content-visibility:auto 跳过屏外分组的布局/绘制；contain-intrinsic-size
              // 给每组约 220px 的占位高度估算，避免滚动跳动。will-change-transform
              // 保留 hover 位移的合成层提示。
              className="card cv-list p-6 will-change-transform sm:p-8"
              style={{ transformOrigin: 'center', containIntrinsicSize: 'auto 220px' }}
              whileHover={{
                x: -6,
                y: -6,
                boxShadow: '14px 14px 34px -10px rgba(6, 78, 59, 0.28)',
              }}
              whileTap={{ scale: 0.99, x: -3, y: -3 }}
              transition={{ type: 'spring', stiffness: 300, damping: 22 }}
            >
              <div className="flex items-center justify-between">
                <span className="font-display text-xl font-bold text-brandDark">
                  {group.weekLabel}
                </span>
                <span className="rounded-full bg-brandFaint px-3 py-1 text-xs font-medium text-brandDark">
                  {group.tasks.length} 项任务
                </span>
              </div>

              <ul className="mt-4 divide-y divide-brandFaint">
                {group.tasks.map((task) => (
                  <li key={task.id} className="flex items-start gap-3 py-3">
                    <span
                      className={[
                        'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                        task.status === 'done' ? 'bg-brand' : 'bg-brandLight',
                      ].join(' ')}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      {onToggleStatus ? (
                        <button
                          type="button"
                          onClick={() => onToggleStatus(task)}
                          className="text-left text-sm text-brandDark hover:underline"
                        >
                          {task.description}
                          <span className="ml-2 text-xs text-gray-400">
                            {task.status === 'done' ? '已完成 · 点击撤销' : '待完成 · 点击完成'}
                          </span>
                        </button>
                      ) : (
                        <p className="text-sm text-brandDark">{task.description}</p>
                      )}
                      <TaskResourceLink task={task} />
                      <p className="mt-0.5 text-xs text-gray-400">{task.taskDate}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </MotionCard>
          ))}
        </div>
      )}
    </section>
  );
}

export default WeekTaskGroups;
