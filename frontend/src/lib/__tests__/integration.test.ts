/**
 * 前端接入集成测试（任务 22.4）
 * - 登录后数据加载与 401 降级
 * - SSE 流式 token 渲染
 * - 打卡 → 今日三态刷新
 * - 任务 done → 阶段进度更新
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '@/lib/httpClient';
import { consumeSse } from '@/lib/sseClient';
import {
  createCheckIn,
  fetchOverviewMetrics,
  setDailyTaskStatus,
  toMetrics,
} from '@/lib/studyApi';
import { computeMagnetOffset, computeTargetScale } from '@/components/motion/utils';

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(frames: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(frames));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('Feature: study-pilot — frontend integration (task 22.4)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('登录会话失效时 apiRequest 降级为 UNAUTHENTICATED', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(
        { status: 'error', code: 'UNAUTHENTICATED', message: '请先登录' },
        401,
      ),
    ) as typeof fetch;

    await expect(apiRequest('/api/metrics/overview?today=2026-10-01')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'UNAUTHENTICATED',
      status: 401,
    });

    const call = (globalThis.fetch as unknown as { mock: { calls: FetchArgs[] } }).mock
      .calls[0];
    expect(String(call[0])).toContain('/api/metrics/overview');
    expect(call[1]?.credentials).toBe('include');
  });

  it('网络失败时给出 NETWORK_ERROR，便于页面空态降级', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    await expect(apiRequest('/api/auth/me')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });

  it('SSE 按帧推送 token，断流后仍保留已渲染 delta', async () => {
    const frames = [
      'event: token\ndata: {"delta":"考"}\n\n',
      'event: token\ndata: {"delta":"研"}\n\n',
      'event: done\ndata: {}\n\n',
    ].join('');

    globalThis.fetch = vi.fn(async () => sseResponse(frames)) as typeof fetch;

    const tokens: string[] = [];
    let done = false;
    await consumeSse({
      path: '/api/assistant/chat',
      body: { message: '你好' },
      onEvent: (event, data) => {
        if (event === 'token') tokens.push(String(data.delta ?? ''));
        if (event === 'done') done = true;
      },
    });

    expect(tokens.join('')).toBe('考研');
    expect(done).toBe(true);
  });

  it('SSE 错误事件不打断已收到的 token', async () => {
    const frames = [
      'event: token\ndata: {"delta":"已生成前半段"}\n\n',
      'event: error\ndata: {"code":"AI_TIMEOUT","message":"首块超时"}\n\n',
    ].join('');
    globalThis.fetch = vi.fn(async () => sseResponse(frames)) as typeof fetch;

    let rendered = '';
    let errCode = '';
    await consumeSse({
      path: '/api/assistant/chat',
      body: { message: '规划' },
      onEvent: (event, data) => {
        if (event === 'token') rendered += String(data.delta ?? '');
        if (event === 'error') errCode = String(data.code ?? '');
      },
    });

    expect(rendered).toBe('已生成前半段');
    expect(errCode).toBe('AI_TIMEOUT');
  });

  it('打卡成功后刷新 overview，今日三态变为已完成', async () => {
    let checkedIn = false;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/check-ins') && init?.method === 'POST') {
        checkedIn = true;
        return jsonResponse({ status: 'ok', checkInId: 'ck-1' }, 201);
      }
      if (url.includes('/api/metrics/overview')) {
        return jsonResponse({
          status: 'ok',
          totalMinutes: checkedIn ? 90 : 0,
          streakDays: checkedIn ? 1 : 0,
          remainingDays: 100,
          phaseProgress: { completed: 0, total: 3 },
          todayStatus: checkedIn ? '已完成' : '未反馈',
        });
      }
      return jsonResponse({ status: 'error', code: 'NOT_FOUND', message: url }, 404);
    }) as typeof fetch;

    const before = toMetrics(await fetchOverviewMetrics('2026-10-01'));
    expect(before.todayStatus).toBe('未反馈');

    await createCheckIn({
      checkDate: '2026-10-01',
      durationMinutes: 90,
      difficulty: 3,
      energy: 4,
    });

    const after = toMetrics(await fetchOverviewMetrics('2026-10-01'));
    expect(after.todayStatus).toBe('已完成');
    expect(after.totalMinutes).toBe(90);
    expect(after.streakDays).toBe(1);
  });

  it('任务标记 done 后返回更新的阶段进度', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/daily-tasks/') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body ?? '{}')) as { status?: string };
        expect(body.status).toBe('done');
        return jsonResponse({
          status: 'ok',
          task: { id: 'task-1', status: 'done' },
          phase: { id: 'phase-1', progressPercent: 40 },
        });
      }
      return jsonResponse({ status: 'error', code: 'NOT_FOUND', message: url }, 404);
    }) as typeof fetch;

    const res = await setDailyTaskStatus('task-1', 'done');
    expect(res.task.status).toBe('done');
    expect(res.phase.progressPercent).toBe(40);
  });
});

describe('Feature: study-pilot, Property 23/24 — motion pure helpers', () => {
  it('Property 23: magnet offset is zero at center and scales with strength', () => {
    const center = { x: 10, y: 20 };
    expect(computeMagnetOffset(center, center, 5)).toEqual({ x: 0, y: 0 });
    expect(computeMagnetOffset({ x: 20, y: 30 }, center, 5)).toEqual({ x: 2, y: 2 });
  });

  it('Property 24: last card scale is 1; earlier cards step down by SCALE_STEP', () => {
    expect(computeTargetScale(2, 3)).toBe(1);
    expect(computeTargetScale(1, 3)).toBeCloseTo(0.97);
    expect(computeTargetScale(0, 3)).toBeCloseTo(0.94);
  });
});
