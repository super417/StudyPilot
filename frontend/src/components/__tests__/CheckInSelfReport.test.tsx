import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import CheckInForm from '../CheckInForm';

it('requires the learner to enter minutes instead of using a planned duration', () => {
  const html = renderToStaticMarkup(createElement(CheckInForm));
  expect(html).toContain('学习分钟（由你填写）');
  expect(html).toMatch(/<input[^>]*required[^>]*min="1"[^>]*value=""/);
});

it('requires a task selection and disables submission when no task exists', () => {
  const html = renderToStaticMarkup(createElement(CheckInForm, { tasks: [{id:'a', description:'任务A'}, {id:'b', description:'任务B'}] }));
  expect(html).toMatch(/<select[^>]*required/);
  expect(html).toContain('value="a"');
  expect(html).toContain('任务B');
  const empty = renderToStaticMarkup(createElement(CheckInForm));
  expect(empty).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
});
