/**
 * 本文件只提供类型，数据由 lib/profileStudyApi.ts 从真实接口派生。
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
