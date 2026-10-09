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
    expect(markup).toContain('确认写入');
    expect(markup).toContain('拒绝');
    expect(markup).toContain('撤销最近一次已确认调整');
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

  it('checkLabel maps unverified distinctly from pass', () => {
    expect(checkLabel('pass')).toBe('通过');
    expect(checkLabel('unverified')).toBe('未验证');
    expect(checkLabel(undefined)).toBe('未验证');
  });
});
