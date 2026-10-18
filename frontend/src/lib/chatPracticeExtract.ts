/**
 * 从助手纯文本消息里切出「题目 / 答案」段落，供「存入今日练习」使用。
 *
 * 这是启发式判断，可能漏检真实题目或误检非题目回复；
 * 宁可少显示按钮，也不要在切不出题干/答案时强行入库。
 */
export function extractChatPractice(
  content: string,
): { question: string; answer: string } | null {
  const text = content.trim();
  if (!text.includes('题') || !text.includes('答案')) return null;

  const heading = (names: string[]) =>
    `(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:\\*\\*|__)?(?:${names.join('|')})(?:\\*\\*|__)?\\s*[:：]?\\s*\\n?`;

  const questionRe = new RegExp(
    `${heading(['题目', '题干'])}([\\s\\S]*?)(?=${heading(['参考答案', '答案'])}|$)`,
    'i',
  );
  const answerRe = new RegExp(
    `${heading(['参考答案', '答案'])}([\\s\\S]*?)(?=${heading(['解析', '解释', '说明', '点评', '为什么'])}|$)`,
    'i',
  );

  const question = text.match(questionRe)?.[1]?.trim() ?? '';
  const answer = text.match(answerRe)?.[1]?.trim() ?? '';
  if (!question || !answer) return null;
  return { question, answer };
}
