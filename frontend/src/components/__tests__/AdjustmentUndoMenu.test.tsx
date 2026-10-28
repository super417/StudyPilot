import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdjustmentPreviewView } from '@/components/assistant/AdjustmentPreviewView';

describe('plan undo menu', () => {
  const props = { pending: null, onConfirm() {}, onReject() {}, onUndo() {} };
  it('renders nothing without a confirmed adjustment', () => {
    expect(
      renderToStaticMarkup(createElement(AdjustmentPreviewView, { ...props, showUndo: false })),
    ).toBe('');
  });
  it('keeps undo inside a closed plan actions disclosure', () => {
    const markup = renderToStaticMarkup(
      createElement(AdjustmentPreviewView, { ...props, showUndo: true }),
    );
    expect(markup).toContain('计划操作</summary>');
    expect(markup).toMatch(/<details[^>]*>.*撤销最近一次已确认调整.*<\/details>/);
    expect(markup).not.toMatch(/<details[^>]*\bopen[\s=>]/);
  });
});
