/**
 * 前端【静态 UI 演示占位数据】（任务 3.1）
 *
 * ⚠️ 重要说明：
 * 本文件为【静态 UI 演示占位数据】，仅用于第一/二阶段无后端时渲染界面视觉。
 * 所有真实内容（学习目标、阶段、每日任务、错题、周报、指标等）均由用户输入的
 * 参数 + AI 生成的规划，在第四/五阶段通过后端接口注入，届时 index.ts 中的
 * getMockXxx() 将替换为真实接口调用（保持相同返回类型即可平滑切换）。
 * 请勿将此处占位值当作产品最终文案或写死内容——它们只是明显的中性示例。
 *
 * _Requirements: 4.2, 5.2, 6.3, 7.3_
 */

import type {
  CheckIn,
  DailyTask,
  Metrics,
  Mistake,
  Phase,
  Plan,
  UserDocument,
  WeeklyReview,
} from './types';

/**
 * 规划（占位）
 * 真实值来源：用户填写的目标/水平/每日时长 + AI 规划的阶段总数与目标日期。
 */
export const mockPlan: Plan = {
  id: 'plan-1',
  goalName: '示例学习目标（占位）',
  subtitle: '科目 A · 科目 B · 科目 C',
  startDate: '2025-01-01',
  goalDate: '2025-12-31',
  currentLevel: '入门（示例）',
  dailyMinutes: 120,
  totalPhases: 5,
  updatedAt: '2025-01-01T09:00:00.000Z',
};

/**
 * 阶段（占位）
 * 条数与 mockPlan.totalPhases 保持一致（5）；第一个 isCurrent=true 用于高亮演示。
 * 真实值来源：AI 依据目标与时长拆分的阶段计划。
 */
export const mockPhases: Phase[] = [
  {
    id: 'phase-1',
    phaseIndex: 1,
    name: '阶段一（示例）',
    startDate: '2025-01-01',
    endDate: '2025-03-15',
    progressPercent: 0,
    isCurrent: true,
    isCompleted: false,
  },
  {
    id: 'phase-2',
    phaseIndex: 2,
    name: '阶段二（示例）',
    startDate: '2025-03-16',
    endDate: '2025-05-31',
    progressPercent: 0,
    isCurrent: false,
    isCompleted: false,
  },
  {
    id: 'phase-3',
    phaseIndex: 3,
    name: '阶段三（示例）',
    startDate: '2025-06-01',
    endDate: '2025-08-15',
    progressPercent: 0,
    isCurrent: false,
    isCompleted: false,
  },
  {
    id: 'phase-4',
    phaseIndex: 4,
    name: '阶段四（示例）',
    startDate: '2025-08-16',
    endDate: '2025-10-31',
    progressPercent: 0,
    isCurrent: false,
    isCompleted: false,
  },
  {
    id: 'phase-5',
    phaseIndex: 5,
    name: '阶段五（示例）',
    startDate: '2025-11-01',
    endDate: '2025-12-31',
    progressPercent: 0,
    isCurrent: false,
    isCompleted: false,
  },
];

/**
 * 每日任务（占位）
 * 真实值来源：AI 规划按阶段/周生成的每日任务，用户可打卡更新状态。
 */
export const mockDailyTasks: DailyTask[] = [
  {
    id: 'task-1',
    phaseId: 'phase-1',
    taskDate: '2025-01-01',
    weekLabel: 'W01',
    description: '示例任务：这里显示由 AI 规划生成的每日任务（占位）',
    status: 'pending',
  },
  {
    id: 'task-2',
    phaseId: 'phase-1',
    taskDate: '2025-01-02',
    weekLabel: 'W01',
    description: '示例任务：这里显示由 AI 规划生成的每日任务（占位）',
    status: 'pending',
  },
  {
    id: 'task-3',
    phaseId: 'phase-1',
    taskDate: '2025-01-03',
    weekLabel: 'W01',
    description: '示例任务：这里显示由 AI 规划生成的每日任务（占位）',
    status: 'pending',
  },
  {
    id: 'task-4',
    phaseId: 'phase-1',
    taskDate: '2025-01-04',
    weekLabel: 'W01',
    description: '示例任务：这里显示由 AI 规划生成的每日任务（占位）',
    status: 'pending',
  },
];

/** 打卡记录（占位）：当前尚无打卡，保持空以对齐指标为 0。 */
export const mockCheckIns: CheckIn[] = [];

/**
 * 错题（占位）
 * 真实值来源：用户录入的错题及 AI 归因，切勿当作真实题目内容。
 */
export const mockMistakes: Mistake[] = [
  {
    id: 'mistake-1',
    question: '示例题目：真实错题内容将由用户录入（占位）',
    myAnswer: '示例：我的答案（占位）',
    whyWrong: '示例：错误原因（占位）',
    correctUnderstanding: '示例：正确理解（占位）',
    reviewStatus: 'pending',
    nextReviewAt: '2025-01-08T09:00:00.000Z',
  },
  {
    id: 'mistake-2',
    question: '示例题目：真实错题内容将由用户录入（占位）',
    myAnswer: '示例：我的答案（占位）',
    whyWrong: '示例：错误原因（占位）',
    correctUnderstanding: '示例：正确理解（占位）',
    reviewStatus: 'scheduled',
    nextReviewAt: '2025-01-09T09:00:00.000Z',
  },
];

/**
 * 周复盘（占位）
 * 真实值来源：由打卡与掌握度数据聚合，掌握度明细科目由用户目标决定。
 */
export const mockWeeklyReview: WeeklyReview = {
  id: 'weekly-1',
  weekStart: '2025-01-01',
  weekEnd: '2025-01-07',
  totalMinutes: 0,
  streakDays: 0,
  completionRate: 0,
  masteryAvg: 0,
  masteryDetail: [
    { subject: '科目 A', percent: 0 },
    { subject: '科目 B', percent: 0 },
    { subject: '模块一', percent: 0 },
    { subject: '模块二', percent: 0 },
  ],
};

/**
 * 用户文档（占位）
 * 真实值来源：用户上传的资料，ready 表示是否完成解析与切块。
 * 保留一个 ready:false 供 DocumentPicker 演示禁选。
 */
export const mockDocuments: UserDocument[] = [
  {
    docId: 'doc-1',
    filename: '示例文档.pdf',
    fileType: 'pdf',
    ready: true,
  },
  {
    docId: 'doc-2',
    filename: '示例笔记.md',
    fileType: 'md',
    ready: true,
  },
  {
    docId: 'doc-3',
    filename: '未就绪示例.docx',
    fileType: 'docx',
    ready: false,
  },
];

/**
 * 总览指标（占位）
 * 真实值来源：Metrics_Service 由打卡/规划派生；phaseProgress.total 与阶段数一致。
 */
export const mockMetrics: Metrics = {
  totalMinutes: 0,
  streakDays: 0,
  remainingDays: 100,
  phaseProgress: { completed: 0, total: 5 },
  todayStatus: '未反馈',
};
