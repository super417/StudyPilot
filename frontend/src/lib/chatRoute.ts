/**
 * 助手发送前的分流。普通句子进入聊天。
 * 只有明确在改当前计划时才重排；资料建议和页面上的 plan 上下文不能单独打开重排。
 * 开始日、旧草稿只接当前会话里的有效补充。换话题后的确认词先重述草稿，不直接落库。
 */
import { isPlanEditIntent } from '@/lib/resourceRequest';

export type ChatRouteKind =
  | 'start'
  | 'legacy-blocked'
  | 'clarify'
  | 'restate-draft'
  | 'regenerate'
  | 'chat';

export interface ChatDecision {
  kind: ChatRouteKind;
  holdDraft: boolean;
}

export interface ChatRouteInput {
  text: string;
  targetPlanId: string | null;
  contextType?: string | null;
  awaitingStart: boolean;
  draftId: string | null;
  legacyDraftBlocked: boolean;
  draftConfirmHeld: boolean;
  activeConversationId: string | null;
  boundConversationId: string | null;
  clarifyQuestion?: string | null;
  startPlanId?: string | null;
}

const CONFIRM =
  /^(?:确定|确认|可以|同步|就这样|就按这个|ok|okay|yes)[。.!！]?$/i;

const START_REPLY =
  /^(?:今天|明天|后天|明晚|\d{4}-\d{2}-\d{2}|\d{1,2}月\d{1,2}日|\d{1,2}-\d{1,2})[。.!！]?$/;

const MINUTES_REPLY = /^(?:每天|每日)?\s*\d{1,4}\s*分钟?$/;

const NEW_TOPIC = /想学|推荐|有什么|什么区别|什么技巧|怎么|吗|[?？]/;

export function summaryForDraft(
  draftId: string,
  previewDraftId: string | null,
  previewSummary: string | null,
): string | null {
  if (!previewDraftId || previewDraftId !== draftId) return null;
  const summary = previewSummary?.trim();
  return summary ? summary : null;
}

export function isConfirmMessage(text: string): boolean {
  return CONFIRM.test(text.trim());
}

export function draftRestateText(
  draftId: string,
  question: string | null,
  summary: string | null,
): string {
  const detail = question
    ? `还在问：${question}`
    : summary
      ? `上次给出的预览是：${summary}`
      : '这份草稿还没有可展示的问题或预览。';
  return `这句先不写入。待确认的仍是草稿 ${draftId}。${detail}如果仍要写入这份草稿，请再发一次「确定」。`;
}

function sameConversation(input: ChatRouteInput): boolean {
  if (!input.boundConversationId) return true;
  return input.boundConversationId === input.activeConversationId;
}

function isStartDateReply(text: string): boolean {
  return START_REPLY.test(text.trim());
}

function askedKinds(question: string | null | undefined): Set<string> {
  const asked = new Set<string>();
  if (!question) return asked;
  if (question.includes('目标日期')) asked.add('date');
  if (question.includes('每日可用学习时长')) asked.add('minutes');
  if (question.includes('当前基础')) asked.add('level');
  if (question.includes('完成标准')) asked.add('criterion');
  if (question.includes('学习内容')) asked.add('name');
  return asked;
}

function isDraftSupplement(text: string, question: string | null | undefined): boolean {
  const trimmed = text.trim();
  if (!trimmed || isConfirmMessage(trimmed) || NEW_TOPIC.test(trimmed)) return false;
  if (isPlanEditIntent(trimmed)) return false;
  if (/取消|算了|不用了|先看|先不/.test(trimmed)) return false;
  const asked = askedKinds(question);
  if (asked.has('date') && isStartDateReply(trimmed)) return true;
  if (asked.has('minutes') && MINUTES_REPLY.test(trimmed)) return true;
  if (asked.has('level') && /^(?:当前基础|基础|水平)\s*[:：]/.test(trimmed)) return true;
  if (
    asked.has('level') &&
    trimmed.length <= 12 &&
    !isStartDateReply(trimmed) &&
    !MINUTES_REPLY.test(trimmed)
  ) {
    return true;
  }
  if (asked.has('criterion') && /^(?:完成标准)\s*[:：]/.test(trimmed)) return true;
  if (asked.has('name') && /^(?:学习内容|目标|科目)\s*[:：]/.test(trimmed)) return true;
  if (asked.has('name') && asked.size === 1 && trimmed.length <= 24 && !isStartDateReply(trimmed)) {
    return true;
  }
  if (
    asked.has('criterion') &&
    asked.size === 1 &&
    trimmed.length <= 40 &&
    !isStartDateReply(trimmed) &&
    !MINUTES_REPLY.test(trimmed)
  ) {
    return true;
  }
  return false;
}

export function decideChatRoute(input: ChatRouteInput): ChatDecision {
  const here = sameConversation(input);
  if (
    here &&
    !input.draftId &&
    input.awaitingStart &&
    input.startPlanId &&
    isStartDateReply(input.text)
  ) {
    return { kind: 'start', holdDraft: false };
  }
  if (input.legacyDraftBlocked && isConfirmMessage(input.text)) {
    return { kind: 'legacy-blocked', holdDraft: false };
  }
  const draftHere = here && Boolean(input.draftId);
  if (draftHere && isConfirmMessage(input.text)) {
    if (input.draftConfirmHeld) return { kind: 'restate-draft', holdDraft: false };
    return { kind: 'clarify', holdDraft: false };
  }
  if (input.targetPlanId && isPlanEditIntent(input.text)) {
    return { kind: 'regenerate', holdDraft: draftHere };
  }
  if (draftHere && isDraftSupplement(input.text, input.clarifyQuestion)) {
    return { kind: 'clarify', holdDraft: false };
  }
  return { kind: 'chat', holdDraft: draftHere };
}
