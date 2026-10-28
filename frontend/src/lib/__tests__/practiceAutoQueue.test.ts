import { describe, expect, it } from 'vitest';
import { completePracticeQuestion, pendingPracticeIds, validBatchSize } from '../practiceAutoQueue';
import type { PracticeQuestion } from '../practiceApi';
const question = (id: string, previous?: string): PracticeQuestion => ({
  id,
  source: 'uploaded',
  subject: '',
  question: id,
  answer: '',
  explanation: '',
  status: 'pending',
  createdAt: '',
  latestGrade: previous ? { answerText: previous, result: 'correct', reason: null } : null,
});
const rows = [question('a'), question('b'), question('c', 'old')];
describe('explicit completion auto grading queue', () => {
  it('requires a positive safe integer', () => {
    for (const value of ['', '0', '-1', '1.5', '2e2', '9007199254740992'])
      expect(validBatchSize(value)).toBeNull();
    expect(validBatchSize('1')).toBe(1);
    expect(validBatchSize('5')).toBe(5);
  });
  it('waits for n distinct completed answers and emits exactly one batch', () => {
    const answers = { a: 'A', b: 'B' };
    const first = completePracticeQuestion([], 'a', 2, rows, answers);
    expect(first).toEqual({ queue: ['a'], batch: [] });
    expect(completePracticeQuestion(first.queue, 'a', 2, rows, answers)).toEqual(first);
    expect(completePracticeQuestion(first.queue, 'b', 2, rows, answers)).toEqual({
      queue: [],
      batch: ['a', 'b'],
    });
  });
  it('n=1 emits immediately, blank and unchanged grades never enter', () => {
    expect(completePracticeQuestion([], 'a', 1, rows, { a: ' A ' })).toEqual({
      queue: [],
      batch: ['a'],
    });
    expect(completePracticeQuestion([], 'b', 1, rows, { b: '  ' })).toEqual({
      queue: [],
      batch: [],
    });
    expect(completePracticeQuestion([], 'c', 1, rows, {})).toEqual({ queue: [], batch: [] });
    expect(completePracticeQuestion([], 'c', 1, rows, { c: 'edited' }).batch).toEqual(['c']);
  });
  it('tail batch excludes deleted, blank, duplicates, and newly graded items', () => {
    expect(pendingPracticeIds(['a', 'a', 'deleted', 'b', 'c'], rows, { a: 'A', b: '' })).toEqual([
      'a',
    ]);
  });
  it('a dispatched failed batch is not retained for endless auto retry', () => {
    const dispatched = completePracticeQuestion(['a'], 'b', 2, rows, { a: 'A', b: 'B' });
    expect(dispatched.queue).toEqual([]);
    const next = completePracticeQuestion(dispatched.queue, 'c', 2, rows, { c: 'new' });
    expect(next).toEqual({ queue: ['c'], batch: [] });
  });
});
