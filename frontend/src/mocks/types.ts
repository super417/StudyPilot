/**
 * 前端展示用 TS 类型定义（任务 3.1）
 *
 * 字段命名采用前端友好的 camelCase，日期统一用 ISO 字符串（YYYY-MM-DD 或完整 ISO）。
 * 对齐 design.md 的 Data Models 与 Metrics 口径，供后续页面用 mock 数据渲染。
 * 第五阶段将由真实接口数据替换。
 *
 * _Requirements: 4.2, 5.2, 6.3, 7.3_
 */

/** 每日任务状态 */
export type DailyTaskStatus = 'pending' | 'done' | 'carried';

/** 错题复习安排状态 */
export type ReviewStatus = 'pending' | 'scheduled' | 'done';

/** 用户文档类型 */
export type DocumentFileType = 'pdf' | 'docx' | 'txt' | 'md';

/** 今日任务三态（总览页任务卡片） */
export type TodayStatus = '未反馈' | '已安排' | '已完成';

/** 学习规划（对应 Plans 表） */
export interface Plan {
  id: string;
  /** 目标名称，如「2028 考研（数学二 + 408）」 */
  goalName: string;
  /** 副标题，如「数学二 · 408 · 英语二」 */
  subtitle: string;
  /** 规划开始日期（环形进度分母起点），ISO 日期 */
  startDate: string;
  /** 目标日期，ISO 日期 */
  goalDate: string;
  /** 当前水平 */
  currentLevel: string;
  /** 每日可用学习时长（分钟） */
  dailyMinutes: number;
  /** 阶段总数 */
  totalPhases: number;
  /** 最近更新时间戳，ISO */
  updatedAt: string;
}

/** 阶段（对应 Phases 表） */
export interface Phase {
  id: string;
  /** 阶段序号（从 1 起） */
  phaseIndex: number;
  /** 阶段名称，如「基础一 · 数据结构」 */
  name: string;
  /** 起始日期，ISO 日期 */
  startDate: string;
  /** 结束日期，ISO 日期 */
  endDate: string;
  /** 进度百分比 0-100 */
  progressPercent: number;
  /** 是否为当前所处阶段（高亮） */
  isCurrent: boolean;
  /** 是否已完成 */
  isCompleted: boolean;
}

/** 每日任务（对应 Daily_Tasks 表） */
export interface DailyTask {
  id: string;
  /** 所属阶段 id */
  phaseId: string;
  /** 任务日期，ISO 日期 */
  taskDate: string;
  /** 周分组标签，如 W38 / W47 */
  weekLabel: string;
  /** 任务描述 */
  description: string;
  /** 状态 */
  status: DailyTaskStatus;
}

/** 打卡记录（对应 Check_Ins 表） */
export interface CheckIn {
  id: string;
  /** 打卡日期，ISO 日期 */
  checkDate: string;
  /** 实际学习时长（分钟） */
  durationMinutes: number;
  /** 主观难度 1-5 */
  difficulty: number;
  /** 精力状态 1-5 */
  energy: number;
  /** 备注 */
  note: string;
}

/** 错题（对应 Mistakes 表） */
export interface Mistake {
  id: string;
  /** 原题 */
  question: string;
  /** 我的答案 */
  myAnswer: string;
  /** 为什么错 */
  whyWrong: string;
  /** 正确理解 */
  correctUnderstanding: string;
  /** 复习安排状态 */
  reviewStatus: ReviewStatus;
  /** 下次复习时间，ISO，可空 */
  nextReviewAt?: string;
  /** 已安排且下次复习时间已到 */
  due?: boolean;
  /** 录入时间，ISO */
  createdAt?: string;
}

/** 某科目掌握度明细项 */
export interface MasteryDetailItem {
  /** 科目名称 */
  subject: string;
  /** 掌握度百分比 0-100 */
  percent: number;
}

/** 周复盘（对应 Weekly_Reviews 表） */
export interface WeeklyReview {
  id: string;
  /** 周起始日期，ISO 日期 */
  weekStart: string;
  /** 周结束日期，ISO 日期 */
  weekEnd: string;
  /** 累计投入分钟 */
  totalMinutes: number;
  /** 连续打卡天数 */
  streakDays: number;
  /** 任务完成率 0-100 */
  completionRate: number;
  /** 知识掌握平均值 0-100（紫色环形图） */
  masteryAvg: number;
  /** 各科目掌握度明细 */
  masteryDetail: MasteryDetailItem[];
}

/** 用户文档（对应 User_Documents 表，前端按文档聚合展示） */
export interface UserDocument {
  /** 文档标识 */
  docId: string;
  /** 文件名 */
  filename: string;
  /** 文件类型 */
  fileType: DocumentFileType;
  /** 是否已完成解析与切块（就绪） */
  ready: boolean;
}

/** 阶段进度聚合 */
export interface PhaseProgress {
  /** 已完成阶段数 */
  completed: number;
  /** 阶段总数 */
  total: number;
}

/** 总览页学习指标（Metrics_Service 派生口径） */
export interface Metrics {
  /** 累计打卡分钟 */
  totalMinutes: number;
  /** 连续打卡天数 */
  streakDays: number;
  /** 剩余天数 */
  remainingDays: number;
  /** 阶段进度 */
  phaseProgress: PhaseProgress;
  /** 今日任务三态 */
  todayStatus: TodayStatus;
}
