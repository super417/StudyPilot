import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  AdjustmentPreviewView,
  checkLabel,
} from '@/components/assistant/AdjustmentPreviewView';
import type { PlanAdjustmentPreview } from '@/lib/plansApi';
import { usePlanSessionStore } from '@/store/planSessionStore';

const samplePending: PlanAdjustmentPreview = {
  id: 'adj-1',
  planId: 'plan-abcdef12',
  status: 'pending',
  instruction: '压缩',
  decisionSummary: '决策摘要文案',
  summary: '决策摘要文案',
  phases: 2,
  usedDocs: [],
  evidenceRefs: [],
  steps: [
    { step: 'load_basis', result: 'ok' },
    { step: 'await_confirm', result: 'pending' },
  ],
  validation: {
    ok: true,
    checks: {
      structure: 'pass',
      protectedTaskRule: 'pass',
      evidenceLocation: 'unverified',
      duration: 'unverified',
    },
  },
  diff: {
    removedOrReplaced: [
      {
        id: 't1',
        taskDate: '2026-10-12',
        description: '旧任务：线代基础',
        status: 'pending',
      },
    ],
    proposedPending: [
      {
        taskDate: '2026-10-13',
        description: '新任务：压缩复习',
        status: 'pending',
      },
    ],
    protectedKept: 2,
  },
};

describe('AdjustmentPreviewView R8', () => {
  it('renders task dates, old/new content, steps, and rule labels', () => {
    const markup = renderToStaticMarkup(
      createElement(AdjustmentPreviewView, {
        pending: samplePending,
        showUndo: true,
        onConfirm: () => undefined,
        onReject: () => undefined,
        onUndo: () => undefined,
      }),
    );
    expect(markup).toContain('2026-10-12');
    expect(markup).toContain('旧任务：线代基础');
    expect(markup).toContain('2026-10-13');
    expect(markup).toContain('新任务：压缩复习');
    expect(markup).toContain('load_basis');
    expect(markup).toContain('结构：通过');
    expect(markup).toContain('历史保护：通过');
    expect(markup).toContain('证据定位：未验证');
    expect(markup).toContain('时长校验：未验证');
    expect(markup).not.toContain('本批未实现');
    expect(markup).toContain('确认写入');
    expect(markup).toContain('disabled');
    expect(markup).toContain('拒绝');
    expect(markup).toContain('撤销最近一次已确认调整');
  });

  it('disables confirm while a local uncheck has not been recomputed', () => {
    const pending: PlanAdjustmentPreview = {
      ...samplePending,
      validation: {
        ok: true,
        checks: {
          structure: 'pass',
          protectedTaskRule: 'pass',
          selection: 'pass',
          evidenceLocation: 'pass',
          duration: 'pass',
          schedule: 'pass',
        },
      },
      diff: {
        removedOrReplaced: [],
        proposedPending: [
          { actionId: 'a0', taskDate: '2026-10-13', description: '任务甲', status: 'pending', estimatedMinutes: 20 },
          { actionId: 'a1', taskDate: '2026-10-14', description: '任务乙', status: 'pending', estimatedMinutes: 20 },
        ],
        candidates: [
          { actionId: 'a0', taskDate: '2026-10-13', description: '任务甲', estimatedMinutes: 20 },
          { actionId: 'a1', taskDate: '2026-10-14', description: '任务乙', estimatedMinutes: 20 },
        ],
        protectedKept: 0,
      },
    };
    const markup = renderToStaticMarkup(
      createElement(AdjustmentPreviewView, {
        pending,
        showUndo: false,
        keptActionIds: ['a0'],
        minuteTexts: {},
        onConfirm: () => undefined,
        onReject: () => undefined,
        onUndo: () => undefined,
      }),
    );
    expect(markup).toContain('任务甲');
    expect(markup).toContain('任务乙');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>确认写入<\/button>/);
  });

  it('shows an invalid minute in the field and not as a previous valid override', () => {
    const pending: PlanAdjustmentPreview = {
      ...samplePending,
      validation: {
        ok: true,
        checks: {
          structure: 'pass',
          evidenceLocation: 'pass',
          duration: 'pass',
          schedule: 'pass',
        },
      },
      diff: {
        ...samplePending.diff,
        proposedPending: [
          { actionId: 'a0', taskDate: '2026-10-13', description: '任务甲', status: 'pending', estimatedMinutes: 30 },
        ],
      },
    };
    const markup = renderToStaticMarkup(
      createElement(AdjustmentPreviewView, {
        pending,
        showUndo: false,
        keptActionIds: ['a0'],
        minuteTexts: { a0: 'abc' },
        onConfirm: () => undefined,
        onReject: () => undefined,
        onUndo: () => undefined,
      }),
    );
    expect(markup).toContain('value="abc"');
    expect(markup).toContain('预计分钟必须是正整数');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>确认写入<\/button>/);
  });

  it('places each snippet under its action and lists only changed plan fields', () => {
    const markup = renderToStaticMarkup(
      createElement(AdjustmentPreviewView, {
        pending: {
          ...samplePending,
          evidenceRefs: [
            {
              kind: 'document',
              actionIds: ['a0'],
              filename: '甲.pdf',
              chunkIndex: 0,
              snippet: '甲片段正文',
            },
            {
              kind: 'document',
              actionIds: ['a1'],
              filename: '乙.pdf',
              chunkIndex: 1,
              snippet: '乙片段正文',
            },
          ],
          diff: {
            removedOrReplaced: [],
            proposedPending: [
              { actionId: 'a0', taskDate: '2026-10-13', description: '动作甲', status: 'pending', estimatedMinutes: 20 },
              { actionId: 'a1', taskDate: '2026-10-14', description: '动作乙', status: 'pending', estimatedMinutes: 20 },
            ],
            protectedKept: 1,
            planChanges: [{ field: 'dailyMinutes', before: 90, after: 120 }],
            keptTasks: [
              {
                id: 'kept-1',
                taskDate: '2026-10-11',
                description: '已完成的线代',
                status: 'done',
                estimatedMinutes: 20,
              },
            ],
          },
        },
        showUndo: false,
        keptActionIds: ['a0', 'a1'],
        onConfirm: () => undefined,
        onReject: () => undefined,
        onUndo: () => undefined,
      }),
    );
    const first = markup.indexOf('动作甲');
    const firstEvidence = markup.indexOf('甲片段正文');
    const second = markup.indexOf('动作乙');
    const secondEvidence = markup.indexOf('乙片段正文');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(firstEvidence).toBeGreaterThan(first);
    expect(second).toBeGreaterThan(firstEvidence);
    expect(secondEvidence).toBeGreaterThan(second);
    expect(markup).toContain('dailyMinutes：90 → 120');
    expect(markup).not.toContain('currentLevel');
    expect(markup).toContain('已完成的线代');
  });

  it('shows page or chunk, known minutes, unknown count, and the cap', () => {
    const markup = renderToStaticMarkup(
      createElement(AdjustmentPreviewView, {
        pending: {
          ...samplePending,
          validation: {
            ok: false,
            checks: {
              structure: 'pass',
              protectedTaskRule: 'pass',
              evidenceLocation: 'insufficient',
              duration: 'unknown',
              schedule: 'pass',
            },
            durationDays: [
              { date: '2026-10-13', knownMinutes: 20, unknownCount: 1, cap: 90, result: 'unknown' },
            ],
          },
          evidenceRefs: [
            {
              kind: 'document',
              filename: '极限.pdf',
              pageStart: 2,
              chunkIndex: 0,
              snippet: '极限定理',
              actionIds: ['a0'],
              matchedTerms: ['定理'],
              literatureSupport: 'suggestion',
            },
          ],
          diff: {
            ...samplePending.diff,
            proposedPending: [
              {
                actionId: 'a0',
                taskDate: '2026-10-13',
                description: '新任务：压缩复习',
                status: 'pending',
                estimatedMinutes: null,
              },
            ],
          },
        },
        showUndo: false,
        onConfirm: () => undefined,
        onReject: () => undefined,
        onUndo: () => undefined,
      }),
    );
    expect(markup).toContain('极限.pdf · 第2页');
    expect(markup).toContain('命中 定理');
    expect(markup).toContain('已知 20 分钟');
    expect(markup).toContain('未知 1 条');
    expect(markup).toContain('上限 90 分钟');
    expect(markup).not.toContain('剩余');
    expect(markup).toContain('预计未知');
  });

  it('hides undo when showUndo is false', () => {
    const markup = renderToStaticMarkup(
      createElement(AdjustmentPreviewView, {
        pending: samplePending,
        showUndo: false,
        onConfirm: () => undefined,
        onReject: () => undefined,
        onUndo: () => undefined,
      }),
    );
    expect(markup).not.toContain('撤销最近一次已确认调整');
  });

  it('bumpPlanDataEpoch increments for Roadmap refresh wiring', () => {
    usePlanSessionStore.setState({ planDataEpoch: 0 });
    usePlanSessionStore.getState().bumpPlanDataEpoch();
    expect(usePlanSessionStore.getState().planDataEpoch).toBe(1);
  });

  it('shows the selected saved minutes when the candidate row is still the old estimate', () => {
    const markup = renderToStaticMarkup(
      createElement(AdjustmentPreviewView, {
        pending: {
          ...samplePending,
          validation: {
            ok: true,
            checks: {
              structure: 'pass',
              protectedTaskRule: 'pass',
              selection: 'pass',
              evidenceLocation: 'pass',
              duration: 'pass',
              schedule: 'pass',
            },
            durationDays: [
              { date: '2026-10-13', knownMinutes: 40, unknownCount: 0, cap: 90, result: 'pass' },
            ],
          },
          diff: {
            removedOrReplaced: [],
            proposedPending: [
              {
                actionId: 'a0',
                taskDate: '2026-10-13',
                description: '已改分钟的任务',
                status: 'pending',
                estimatedMinutes: 40,
              },
            ],
            candidates: [
              {
                actionId: 'a0',
                taskDate: '2026-10-13',
                description: '已改分钟的任务',
                estimatedMinutes: 30,
              },
            ],
            protectedKept: 0,
          },
        },
        showUndo: false,
        keptActionIds: ['a0'],
        minuteTexts: {},
        onConfirm: () => undefined,
        onReject: () => undefined,
        onUndo: () => undefined,
      }),
    );
    expect(markup).toContain('预计 40 分钟');
    expect(markup).not.toContain('预计 30 分钟');
    expect(markup).toContain('value="40"');
    expect(markup).toContain('已知 40 分钟');
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>确认写入<\/button>/);
  });

  it('shows remedy choices and blocks confirm while the option is dirty', () => {
    const pending: PlanAdjustmentPreview = {
      ...samplePending,
      decisionSummary: '补救方案，未调用模型',
      validation: { ok: true, checks: { capacity: 'pass', selection: 'pass' } },
      diff: {
        removedOrReplaced: [],
        proposedPending: [
          {
            actionId: 'src-1',
            taskDate: '2026-10-13',
            description: '待补的过期任务',
            status: 'pending',
            estimatedMinutes: 30,
          },
        ],
        protectedKept: 1,
        remedy: {
          selectedOption: 'spread',
          options: [
            { id: 'spread', label: '分散补做', ok: false },
            { id: 'reduce', label: '本次不补做', ok: true },
            { id: 'extend', label: '延后截止', ok: true, goalDate: '2026-10-13' },
          ],
          arranged: [
            {
              sourceId: 'src-1',
              taskDate: '2026-10-13',
              description: '待补的过期任务',
              estimatedMinutes: 30,
              phaseEnd: '2026-10-10',
            },
          ],
          notArranged: [],
          candidates: [
            {
              sourceId: 'src-1',
              description: '待补的过期任务',
              taskDate: '2026-10-10',
              estimatedMinutes: 30,
            },
          ],
          doneCount: 1,
          recordedMinutes: null,
          todayAvailable: null,
          overLimit: false,
          phaseHistoryUnchanged: true,
        },
      },
    };
    const markup = renderToStaticMarkup(
      createElement(AdjustmentPreviewView, {
        pending,
        showUndo: false,
        keptActionIds: ['src-1'],
        remedyOption: 'extend',
        extraDirty: true,
        onConfirm: () => undefined,
        onReject: () => undefined,
        onUndo: () => undefined,
      }),
    );
    expect(markup).toContain('延后截止');
    expect(markup).toContain('本次不补做');
    expect(markup).toContain('未记录');
    expect(markup).toContain('实际剩余未知');
    expect(markup).toContain('阶段历史结束日未改');
    expect(markup).toContain('已完成 1 条');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>确认写入<\/button>/);
  });

  it('confirms a synced remedy preview and edits unknown minutes', () => {
    const base: PlanAdjustmentPreview = {
      ...samplePending,
      decisionSummary: '补救方案，未调用模型',
      validation: {
        ok: true,
        contract: 'remedy',
        checks: { capacity: 'pass', selection: 'pass' },
        durationDays: [
          { date: '2026-10-13', knownMinutes: 30, unknownCount: 0, cap: 60, result: 'pass' },
        ],
      },
      evidenceRefs: [
        {
          kind: 'task',
          actionId: 'src-1',
          taskDate: '2026-10-10',
          description: '待补的过期任务',
        },
        {
          kind: 'checkin',
          checkInId: 'ci-1',
          checkDate: '2026-10-11',
          durationMinutes: 15,
          difficulty: 4,
          energy: 2,
          note: 'review-difficulty-note',
        },
      ],
      diff: {
        removedOrReplaced: [],
        proposedPending: [
          {
            actionId: 'src-1',
            taskDate: '2026-10-13',
            description: '待补的过期任务',
            status: 'pending',
            estimatedMinutes: 30,
          },
        ],
        protectedKept: 0,
        remedy: {
          selectedOption: 'spread',
          options: [
            { id: 'spread', label: '分散补做', ok: true },
            { id: 'reduce', label: '本次不补做', ok: true },
            { id: 'extend', label: '延后截止', ok: true },
          ],
          arranged: [
            {
              sourceId: 'src-1',
              taskDate: '2026-10-13',
              description: '待补的过期任务',
              estimatedMinutes: 30,
            },
          ],
          notArranged: [],
          candidates: [
            {
              sourceId: 'src-1',
              description: '待补的过期任务',
              taskDate: '2026-10-10',
              estimatedMinutes: 30,
            },
          ],
          doneCount: 1,
          dailyMinutes: 60,
          recordedMinutes: 15,
          todayAvailable: 45,
          overLimit: false,
          phaseHistoryUnchanged: true,
        },
      },
    };
    const ready = renderToStaticMarkup(
      createElement(AdjustmentPreviewView, {
        pending: base,
        showUndo: false,
        keptActionIds: ['src-1'],
        remedyOption: 'spread',
        extraDirty: false,
        onConfirm: () => undefined,
        onReject: () => undefined,
        onUndo: () => undefined,
      }),
    );
    expect(ready).toContain('容量：通过');
    expect(ready).toContain('review-difficulty-note');
    expect(ready).toContain('本任务事实');
    expect(ready).toContain('每日上限 60 分钟');
    expect(ready).toContain('已知 30 分钟');
    expect(ready).not.toMatch(/<button[^>]*disabled=""[^>]*>确认写入<\/button>/);

    const unknown: PlanAdjustmentPreview = {
      ...base,
      validation: { ok: false, contract: 'remedy', checks: { capacity: 'unknown', selection: 'pass' } },
      diff: {
        ...base.diff,
        proposedPending: [],
        remedy: {
          ...base.diff.remedy!,
          arranged: [],
          candidates: [
            {
              sourceId: 'src-1',
              description: '分钟未知',
              taskDate: '2026-10-10',
              estimatedMinutes: null,
            },
          ],
        },
      },
    };
    const beforeSave = renderToStaticMarkup(
      createElement(AdjustmentPreviewView, {
        pending: unknown,
        showUndo: false,
        keptActionIds: ['src-1'],
        minuteTexts: { 'src-1': '25' },
        onConfirm: () => undefined,
        onReject: () => undefined,
        onUndo: () => undefined,
      }),
    );
    expect(beforeSave).toMatch(/inputmode="numeric"/i);
    expect(beforeSave).toContain('value="25"');
    expect(beforeSave).toMatch(/<button[^>]*disabled=""[^>]*>确认写入<\/button>/);

    const saved: PlanAdjustmentPreview = {
      ...unknown,
      selectionVersion: 2,
      validation: { ok: true, contract: 'remedy', checks: { capacity: 'pass', selection: 'pass' } },
      diff: {
        ...unknown.diff,
        remedy: {
          ...unknown.diff.remedy!,
          candidates: [
            {
              sourceId: 'src-1',
              description: '分钟未知',
              taskDate: '2026-10-10',
              estimatedMinutes: 25,
            },
          ],
        },
      },
    };
    const afterSave = renderToStaticMarkup(
      createElement(AdjustmentPreviewView, {
        pending: saved,
        showUndo: false,
        keptActionIds: ['src-1'],
        minuteTexts: {},
        extraDirty: false,
        onConfirm: () => undefined,
        onReject: () => undefined,
        onUndo: () => undefined,
      }),
    );
    expect(afterSave).toContain('预计 25 分钟');
    expect(afterSave).toContain('value="25"');
    expect(afterSave).not.toContain('预计未知');
  });

  it('checkLabel maps unverified distinctly from pass', () => {
    expect(checkLabel('pass')).toBe('通过');
    expect(checkLabel('unverified')).toBe('未验证');
    expect(checkLabel(undefined)).toBe('未验证');
  });
});
