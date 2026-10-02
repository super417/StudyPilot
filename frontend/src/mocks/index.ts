/**
 * mock 数据层统一出口（任务 3.1）
 *
 * 聚合类型定义、示例数据与同步取数函数，供四大页面用假数据渲染。
 * 第五阶段将用真实接口调用替换下方取数函数（保持相同返回类型即可平滑切换）。
 *
 * _Requirements: 4.2, 5.2, 6.3, 7.3_
 */

export type {
  CheckIn,
  DailyTask,
  DailyTaskStatus,
  DocumentFileType,
  MasteryDetailItem,
  Metrics,
  Mistake,
  Phase,
  PhaseProgress,
  Plan,
  ReviewStatus,
  TodayStatus,
  UserDocument,
  WeeklyReview,
} from './types';

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

import {
  mockCheckIns,
  mockDailyTasks,
  mockDocuments,
  mockMetrics,
  mockMistakes,
  mockPhases,
  mockPlan,
  mockWeeklyReview,
} from './data';

export {
  mockCheckIns,
  mockDailyTasks,
  mockDocuments,
  mockMetrics,
  mockMistakes,
  mockPhases,
  mockPlan,
  mockWeeklyReview,
};

/** 取当前学习规划 */
export function getMockPlan(): Plan {
  return mockPlan;
}

/** 取全部阶段（按 phaseIndex 升序） */
export function getMockPhases(): Phase[] {
  return mockPhases;
}

/** 取总览页学习指标 */
export function getMockMetrics(): Metrics {
  return mockMetrics;
}

/** 取错题列表 */
export function getMockMistakes(): Mistake[] {
  return mockMistakes;
}

/** 取最近一份周复盘 */
export function getMockWeeklyReview(): WeeklyReview {
  return mockWeeklyReview;
}

/** 取每日任务列表 */
export function getMockDailyTasks(): DailyTask[] {
  return mockDailyTasks;
}

/** 取打卡记录列表 */
export function getMockCheckIns(): CheckIn[] {
  return mockCheckIns;
}

/** 取用户文档列表（供 DocumentPicker 使用） */
export function getMockDocuments(): UserDocument[] {
  return mockDocuments;
}
