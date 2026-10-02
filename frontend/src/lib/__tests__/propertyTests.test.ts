/**
 * Frontend property tests (fast-check, ≥100 iterations).
 *
 * Feature: study-pilot, Property 6 / 10 / 11 / 19 / 23 / 24 / 25 / 26
 */
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isValidBaseUrl } from '@/lib/baseUrl';
import { computeElapsedPercent } from '@/lib/goalProgress';
import { clampIconPosition } from '@/store/clampIconPosition';
import {
  MAX_MESSAGES,
  trimHistory,
  useAssistantStore,
  type AssistantContext,
  type ChatMessage,
} from '@/store/assistantStore';
import {
  CHAR_MAX_OPACITY,
  CHAR_MIN_OPACITY,
  computeCharOpacity,
  computeMagnetOffset,
  computeTargetScale,
  FADE_IN_DEFAULTS,
  SCALE_STEP,
} from '@/components/motion/utils';

const ITERATIONS = 100;

describe('Feature: study-pilot, Property 6: Base URL 格式校验一致性', () => {
  it('passes iff trimmed string starts with http:// or https://', () => {
    fc.assert(
      fc.property(fc.string(), (url) => {
        const expected = /^https?:\/\//.test(url.trim());
        expect(isValidBaseUrl(url)).toBe(expected);
      }),
      { numRuns: ITERATIONS },
    );
  });
});

describe('Feature: study-pilot, Property 10: 拖拽/resize 后图标恒在视口内', () => {
  it('clamped point stays in viewport and is nearest legal point', () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.float({ min: -2000, max: 4000, noNaN: true }),
          y: fc.float({ min: -2000, max: 4000, noNaN: true }),
        }),
        fc.record({
          width: fc.float({ min: 1, max: 2000, noNaN: true }),
          height: fc.float({ min: 1, max: 2000, noNaN: true }),
        }),
        fc.record({
          width: fc.float({ min: 1, max: 200, noNaN: true }),
          height: fc.float({ min: 1, max: 200, noNaN: true }),
        }),
        (pos, viewport, icon) => {
          const clamped = clampIconPosition(pos, viewport, icon);
          const maxX = Math.max(0, viewport.width - icon.width);
          const maxY = Math.max(0, viewport.height - icon.height);
          expect(clamped.x).toBeGreaterThanOrEqual(0);
          expect(clamped.y).toBeGreaterThanOrEqual(0);
          expect(clamped.x).toBeLessThanOrEqual(maxX);
          expect(clamped.y).toBeLessThanOrEqual(maxY);
          expect(clamped.x).toBe(Math.min(Math.max(pos.x, 0), maxX));
          expect(clamped.y).toBe(Math.min(Math.max(pos.y, 0), maxY));
        },
      ),
      { numRuns: ITERATIONS },
    );
  });
});

describe('Feature: study-pilot, Property 11: 会话历史保留与上下文覆盖', () => {
  it('trimHistory keeps order and at most MAX_MESSAGES', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 250 }), (contents) => {
        const messages: ChatMessage[] = contents.map((content, i) => ({
          id: `m-${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content,
        }));
        const trimmed = trimHistory(messages, MAX_MESSAGES);
        expect(trimmed.length).toBe(Math.min(messages.length, MAX_MESSAGES));
        expect(trimmed).toEqual(messages.slice(Math.max(0, messages.length - MAX_MESSAGES)));
      }),
      { numRuns: ITERATIONS },
    );
  });

  it('openAssistantWithContext overwrites context without clearing messages', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 20 }),
        fc.constantFrom('mistake', 'plan', 'free') as fc.Arbitrary<AssistantContext['type']>,
        fc.string({ minLength: 1, maxLength: 16 }),
        (contents, type, refId) => {
          const messages: ChatMessage[] = contents.map((content, i) => ({
            id: `m-${i}`,
            role: 'user' as const,
            content,
          }));
          const conversationId = 'conv-property-11';
          useAssistantStore.setState({
            open: false,
            context: { type: 'free' },
            activeId: conversationId,
            messagesByConversation: { [conversationId]: messages },
            conversations: [
              {
                id: conversationId,
                title: '新对话',
                createdAt: 1,
                updatedAt: 1,
              },
            ],
            hydrated: true,
            streaming: false,
            position: { x: 0, y: 0 },
          });

          const before = useAssistantStore.getState().messagesByConversation[conversationId];
          useAssistantStore.getState().openAssistantWithContext({ type, refId, hint: 'h' });
          const after = useAssistantStore.getState();

          expect(after.open).toBe(true);
          expect(after.context).toEqual({ type, refId, hint: 'h' });
          expect(after.messagesByConversation[conversationId]).toEqual(before);
          expect(after.messagesByConversation[conversationId]?.length).toBeGreaterThanOrEqual(
            Math.min(contents.length, MAX_MESSAGES),
          );
        },
      ),
      { numRuns: ITERATIONS },
    );
  });
});

describe('Feature: study-pilot, Property 19: 环形进度落在 0-100 且随时间单调', () => {
  it('elapsed percent is in [0,100] and non-decreasing as today advances', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 1, max: 400 }),
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 0, max: 60 }),
        (startOffset, span, todayOffset, delta) => {
          const start = new Date(Date.UTC(2026, 0, 1 + startOffset));
          const goal = new Date(start.getTime() + span * 86_400_000);
          const today = new Date(start.getTime() + todayOffset * 86_400_000);
          const later = new Date(today.getTime() + delta * 86_400_000);

          const a = computeElapsedPercent(start, goal, today);
          const b = computeElapsedPercent(start, goal, later);
          expect(a).toBeGreaterThanOrEqual(0);
          expect(a).toBeLessThanOrEqual(100);
          expect(b).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThanOrEqual(100);
          expect(b).toBeGreaterThanOrEqual(a);
        },
      ),
      { numRuns: ITERATIONS },
    );
  });
});

describe('Feature: study-pilot, Property 23: Magnet 位移公式正确性', () => {
  it('offset equals (cursor - center) / strength', () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.float({ min: -1000, max: 1000, noNaN: true }),
          y: fc.float({ min: -1000, max: 1000, noNaN: true }),
        }),
        fc.record({
          x: fc.float({ min: -1000, max: 1000, noNaN: true }),
          y: fc.float({ min: -1000, max: 1000, noNaN: true }),
        }),
        fc.float({ min: Math.fround(0.5), max: 20, noNaN: true }),
        (cursor, center, strength) => {
          const offset = computeMagnetOffset(cursor, center, strength);
          expect(offset.x).toBeCloseTo((cursor.x - center.x) / strength, 5);
          expect(offset.y).toBeCloseTo((cursor.y - center.y) / strength, 5);
        },
      ),
      { numRuns: ITERATIONS },
    );
  });
});

describe('Feature: study-pilot, Property 24: StickyStack 缩放公式正确性', () => {
  it('last card is 1; earlier cards step down by SCALE_STEP', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (total) => {
        for (let index = 0; index < total; index += 1) {
          const scale = computeTargetScale(index, total);
          expect(scale).toBeCloseTo(1 - (total - 1 - index) * SCALE_STEP, 8);
        }
        expect(computeTargetScale(total - 1, total)).toBe(1);
      }),
      { numRuns: ITERATIONS },
    );
  });
});

describe('Feature: study-pilot, Property 25: FadeIn 参数与默认值', () => {
  it('defaults match design (delay 0, duration 0.7, x/y 0)', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        expect(FADE_IN_DEFAULTS.delay).toBe(0);
        expect(FADE_IN_DEFAULTS.duration).toBe(0.7);
        expect(FADE_IN_DEFAULTS.x).toBe(0);
        expect(FADE_IN_DEFAULTS.y).toBe(0);
      }),
      { numRuns: ITERATIONS },
    );
  });
});

describe('Feature: study-pilot, Property 26: AnimatedText 字符不透明度随进度单调', () => {
  it('opacity is non-decreasing in progress for each character', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 24 }),
        fc.integer({ min: 0, max: 23 }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        (total, rawIndex, p1, p2) => {
          const index = rawIndex % total;
          const lo = Math.min(p1, p2);
          const hi = Math.max(p1, p2);
          const a = computeCharOpacity(lo, index, total);
          const b = computeCharOpacity(hi, index, total);
          expect(a).toBeGreaterThanOrEqual(CHAR_MIN_OPACITY);
          expect(b).toBeLessThanOrEqual(CHAR_MAX_OPACITY);
          expect(b).toBeGreaterThanOrEqual(a);
        },
      ),
      { numRuns: ITERATIONS },
    );
  });
});
