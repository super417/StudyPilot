import type { PracticeQuestion } from './practiceApi';

export function validBatchSize(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const size = Number(value);
  return Number.isSafeInteger(size) ? size : null;
}

export function pendingPracticeIds(
  ids: string[],
  questions: PracticeQuestion[],
  answers: Record<string, string>,
): string[] {
  return [...new Set(ids)].filter((id) => {
    const item = questions.find((question) => question.id === id);
    if (!item) return false;
    const answer = (answers[id] ?? item.latestGrade?.answerText ?? '').trim();
    return !!answer && answer !== item.latestGrade?.answerText.trim();
  });
}

export function completePracticeQuestion(
  queue: string[],
  id: string,
  size: number,
  questions: PracticeQuestion[],
  answers: Record<string, string>,
) {
  const next = pendingPracticeIds([...queue, id], questions, answers);
  return next.length >= size
    ? { queue: next.slice(size), batch: next.slice(0, size) }
    : { queue: next, batch: [] };
}
