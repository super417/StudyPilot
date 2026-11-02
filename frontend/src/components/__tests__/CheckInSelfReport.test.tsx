import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import CheckInForm from '../CheckInForm';

it('requires the learner to enter minutes instead of using a planned duration', () => {
  const html = renderToStaticMarkup(createElement(CheckInForm));
  expect(html).toContain('学习分钟（由你填写）');
  expect(html).toMatch(/<input[^>]*required[^>]*min="1"[^>]*value=""/);
});
