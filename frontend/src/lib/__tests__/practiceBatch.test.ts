import { describe, expect, it, vi, beforeEach } from 'vitest';
import { gradePracticeBatch } from '../practiceBatch';
import { gradePractice, type PracticeQuestion } from '../practiceApi';
vi.mock('../practiceApi', () => ({ gradePractice: vi.fn() }));
const question = (id: string, graded?: string): PracticeQuestion => ({
  id,
  source: 'uploaded',
  subject: '',
  question: id,
  answer: '',
  explanation: '',
  status: 'pending',
  createdAt: '',
  latestGrade: graded === undefined ? null : { answerText: graded, result: 'partial', reason: '' },
});
const callbacks = () => ({ progress: vi.fn(), success: vi.fn(), failure: vi.fn() });
beforeEach(() => vi.clearAllMocks());
describe('batch grading', () => {
  it('grades selected answered questions only, skipping blank and unchanged persisted grades', async () => {
    vi.mocked(gradePractice).mockResolvedValue({ result: 'correct' } as never);
    const result = await gradePracticeBatch(
      [question('blank'), question('same', 'old'), question('new'), question('excluded')],
      ['blank', 'same', 'new'],
      { new: ' answer ', excluded: 'no' },
      callbacks(),
    );
    expect(gradePractice).toHaveBeenCalledExactlyOnceWith('new', 'answer');
    expect(result).toEqual({ total: 1, success: 1, failed: [], blank: 1, unchanged: 1 });
  });
  it('continues after failure, reports progress, and can retry just failures', async () => {
    vi.mocked(gradePractice)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ result: 'correct' } as never);
    const cb = callbacks();
    const rows = [question('a'), question('b')];
    const first = await gradePracticeBatch(rows, ['a', 'b'], { a: 'A', b: 'B' }, cb);
    expect(first.failed).toEqual(['a']);
    expect(cb.failure).toHaveBeenCalledTimes(1);
    expect(cb.progress.mock.calls).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
    await gradePracticeBatch(rows, first.failed, { a: 'A', b: 'B' }, callbacks());
    expect(vi.mocked(gradePractice).mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'a']);
  });
  it('waits for each request and permits grading an edited previously graded answer', async () => {
    let resolveFirst!: (value: never) => void;
    vi.mocked(gradePractice)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({ result: 'correct' } as never);
    const pending = gradePracticeBatch(
      [question('a', 'old'), question('b')],
      ['a', 'b'],
      { a: 'edited', b: 'B' },
      callbacks(),
    );
    expect(gradePractice).toHaveBeenCalledTimes(1);
    resolveFirst({ result: 'correct' } as never);
    await pending;
    expect(gradePractice).toHaveBeenNthCalledWith(1, 'a', 'edited');
    expect(gradePractice).toHaveBeenNthCalledWith(2, 'b', 'B');
  });
});
