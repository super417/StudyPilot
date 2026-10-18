/**
 * 从助手纯文本消息里切出「题目 / 答案」段落，供「存入今日练习」使用。
 *
 * 这是启发式判断，可能漏检真实题目或误检非题目回复；
 * 宁可少显示按钮，也不要在切不出题干/答案时强行入库。
 */

const STEM_HEADINGS = ['题目', '题干'] as const;
/** 无「题目/题干」时，独立题型标题可作题干起点（不含解析/参考答案等） */
const TYPE_HEADINGS = [
  '判断题',
  '选择题',
  '填空题',
  '简答题',
  '代码题',
  '改错题',
  '编程题',
] as const;

function heading(names: readonly string[]): string {
  return `(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:\\*\\*|__)?(?:${names.join('|')})(?:\\*\\*|__)?\\s*[:：]?\\s*\\n?`;
}

/** 题型标题必须独占一行并换行，正文从下一行起，避免把标题本身切进题干 */
function typeHeading(names: readonly string[]): string {
  return `(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:\\*\\*|__)?(?:${names.join('|')})(?:\\*\\*|__)?\\s*[:：]?\\s*\\n`;
}

function cleanPart(raw: string): string {
  return raw.replace(/^\*+|\*+$/g, '').trim();
}

export function extractChatPractice(
  content: string,
): { question: string; answer: string } | null {
  const text = content.trim();
  if (!text.includes('题') || !text.includes('答案')) return null;

  const answerStop = heading(['解析', '解释', '说明', '点评', '为什么']);
  const answerRe = new RegExp(
    `${heading(['参考答案', '答案'])}([\\s\\S]*?)(?=${answerStop}|$)`,
    'i',
  );
  const answer = cleanPart(text.match(answerRe)?.[1] ?? '');
  if (!answer) return null;

  const stemRe = new RegExp(
    `${heading(STEM_HEADINGS)}([\\s\\S]*?)(?=${heading(['参考答案', '答案'])}|$)`,
    'i',
  );
  let question = cleanPart(text.match(stemRe)?.[1] ?? '');

  if (!question) {
    const typeRe = new RegExp(
      `${typeHeading(TYPE_HEADINGS)}([\\s\\S]*?)(?=${heading(['参考答案', '答案'])}|$)`,
      'i',
    );
    question = cleanPart(text.match(typeRe)?.[1] ?? '');
  }

  if (!question || !answer) return null;
  return { question, answer };
}
