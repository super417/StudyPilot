/**
 * 个人中心占位数据层（无后端的卡片专用）。
 *
 * 学习资料 / 学习进度 / 学习统计 / 课程管理 / 笔记 这五类数据后端尚未提供接口，
 * 这里用中性占位数据 + Promise 异步取数函数模拟，便于页面实现 loading / 空状态。
 * 每个取数函数上方标注对应的后端接口与「待后端实现」。
 *
 * 说明：数值均为中性占位，不代表任何真实业务统计。
 */

/** 学习资料概览。 */
export interface StudyMaterialsOverview {
  /** 资料总数 */
  total: number;
  /** 最近添加的资料名 */
  recentTitle: string;
  /** 最近添加时间（相对文案） */
  recentAddedAt: string;
  /** 分类标签 */
  categories: string[];
}

/** 学习进度概览。 */
export interface StudyProgressOverview {
  /** 总体进度百分比 0-100（阶段完成比） */
  overallPercent: number;
  /** 今日学习时长（分钟）；无单日时长接口时为 0 */
  todayMinutes: number;
  /** 今日三态（真实 metrics） */
  todayStatus?: string;
  /** 本周目标（分钟）；若 weekTaskMode 则为任务总数 */
  weeklyGoalMinutes: number;
  /** 本周已完成（分钟）；若 weekTaskMode 则为已完成任务数 */
  weeklyDoneMinutes: number;
  /** true 时周进度按「任务数」展示，非分钟 */
  weekTaskMode?: boolean;
}

/** 学习统计概览。 */
export interface StudyStatsOverview {
  /** 连续学习天数 */
  streakDays: number;
  /** 本周学习时长（分钟） */
  weeklyMinutes: number;
  /** 完成任务数 */
  completedTasks: number;
  /** 知识点掌握百分比 0-100 */
  masteryPercent: number;
  /** 近 7 日每日学习时长（分钟），用于迷你趋势图 */
  weeklyTrend: number[];
}

/** 课程概览。 */
export interface CoursesOverview {
  /** 在学课程数 */
  activeCount: number;
  /** 最近课程名 */
  recentCourse: string;
  /** 下一个任务描述 */
  nextTask: string;
}

/** 单条笔记。 */
export interface NoteItem {
  id: string;
  /** 笔记标题 */
  title: string;
  /** 所属课程 / 标签 */
  course: string;
  /** 更新时间（相对文案） */
  updatedAt: string;
}

/** 笔记概览。 */
export interface NotesOverview {
  /** 笔记总数 */
  total: number;
  /** 最近 1-3 条笔记 */
  recent: NoteItem[];
}

/** 模拟网络延迟，让页面能真实呈现 loading。 */
function delay<T>(value: T, ms = 320): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
}

/**
 * 取学习资料概览。
 * 已对接 GET /api/documents（StudyMaterialsCard → documentsStore.hydrateFromServer）。
 */
export function fetchStudyMaterials(): Promise<StudyMaterialsOverview> {
  return delay({
    total: 12,
    recentTitle: '高等数学·第七章 讲义',
    recentAddedAt: '2 小时前',
    categories: ['数学', '专业课', '英语', '真题'],
  });
}

/**
 * 取学习进度概览。
 * TODO(backend): 对接 GET /api/metrics/overview（待后端实现），返回总体进度与今日/本周时长。
 */
export function fetchStudyProgress(): Promise<StudyProgressOverview> {
  return delay({
    overallPercent: 42,
    todayMinutes: 95,
    weeklyGoalMinutes: 900,
    weeklyDoneMinutes: 540,
  });
}

/**
 * 取学习统计概览。
 * TODO(backend): 对接 GET /api/metrics/stats（待后端实现），返回连续天数、时长、任务数与掌握度趋势。
 */
export function fetchStudyStats(): Promise<StudyStatsOverview> {
  return delay({
    streakDays: 8,
    weeklyMinutes: 540,
    completedTasks: 23,
    masteryPercent: 61,
    weeklyTrend: [40, 60, 30, 90, 75, 120, 95],
  });
}

/**
 * 取课程概览。
 * TODO(backend): 对接 GET /api/courses（待后端实现），返回在学课程、最近课程与下一个任务。
 */
export function fetchCourses(): Promise<CoursesOverview> {
  return delay({
    activeCount: 4,
    recentCourse: '数据结构与算法',
    nextTask: '完成第 3 章课后习题',
  });
}

/**
 * 取笔记概览。
 * TODO(backend): 对接 GET /api/notes（待后端实现），返回笔记总数与最近笔记。
 */
export function fetchNotes(): Promise<NotesOverview> {
  return delay({
    total: 18,
    recent: [
      { id: 'n1', title: '二叉树遍历要点', course: '数据结构', updatedAt: '今天' },
      { id: 'n2', title: '中值定理易错点', course: '高等数学', updatedAt: '昨天' },
      { id: 'n3', title: '进程与线程对比', course: '操作系统', updatedAt: '3 天前' },
    ],
  });
}

/** 单条今日待办。 */
export interface TodoItem {
  id: string;
  /** 待办文案 */
  title: string;
  /** 场景标签（考研 / 科研） */
  tag: string;
  /** 是否已完成 */
  done: boolean;
}

/** 单条最近动态。 */
export interface ActivityItem {
  id: string;
  /** 动态文案 */
  text: string;
  /** 相对时间 */
  at: string;
}

/**
 * 取今日待办（考研 / 科研学习场景）。
 * TODO(backend): 对接 GET /api/tasks/today（待后端实现），返回当日任务清单与完成态。
 */
export function fetchTodayTodos(): Promise<TodoItem[]> {
  return delay([
    { id: 't1', title: '英语真题阅读 2 篇 + 精析', tag: '考研', done: false },
    { id: 't2', title: '高数：中值定理专题 30 分钟', tag: '考研', done: false },
    { id: 't3', title: '精读组会论文引言与方法', tag: '科研', done: true },
  ]);
}

/**
 * 取最近动态。
 * TODO(backend): 对接 GET /api/activities（待后端实现），聚合学习 / 科研操作流水。
 */
export function fetchRecentActivities(): Promise<ActivityItem[]> {
  return delay([
    { id: 'a1', text: '完成「操作系统」第 3 章课后习题', at: '1 小时前' },
    { id: 'a2', text: '将 2 道错题加入错题本', at: '今天上午' },
    { id: 'a3', text: '上传《高等数学·第七章 讲义》', at: '昨天' },
    { id: 'a4', text: '生成本周复盘周报', at: '2 天前' },
  ]);
}
