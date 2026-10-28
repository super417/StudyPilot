import { gradePractice, type PracticeGradeResponse, type PracticeQuestion } from './practiceApi';

/** Snapshot answers once, then grade in order; one failure must not stop later questions. */
export async function gradePracticeBatch(
  questions: PracticeQuestion[],
  ids: string[],
  answers: Record<string, string>,
  callbacks: {
    progress: (done: number, total: number) => void;
    success: (question: PracticeQuestion, answer: string, result: PracticeGradeResponse) => void;
    failure: (question: PracticeQuestion, error: unknown) => void;
  },
) {
  let blank = 0,
    unchanged = 0,
    success = 0;
  const failed: string[] = [];
  const targets = questions
    .filter((item) => ids.includes(item.id))
    .flatMap((item) => {
      const answer = (answers[item.id] ?? item.latestGrade?.answerText ?? '').trim();
      if (!answer) {
        blank++;
        return [];
      }
      if (answer === item.latestGrade?.answerText.trim()) {
        unchanged++;
        return [];
      }
      return [{ item, answer }];
    });
  callbacks.progress(0, targets.length);
  for (const [index, { item, answer }] of targets.entries()) {
    try {
      const result = await gradePractice(item.id, answer);
      success++;
      callbacks.success(item, answer, result);
    } catch (error) {
      failed.push(item.id);
      callbacks.failure(item, error);
    }
    callbacks.progress(index + 1, targets.length);
  }
  return { total: targets.length, success, failed, blank, unchanged };
}
