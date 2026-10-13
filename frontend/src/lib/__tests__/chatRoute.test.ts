import { describe, expect, it } from 'vitest';
import { decideChatRoute, draftRestateText, summaryForDraft } from '@/lib/chatRoute';

const PHRASE = '我是一个小白，想学王道数据结构，你帮我推荐规划';

const idle = {
  targetPlanId: null as string | null,
  contextType: null as string | null,
  awaitingStart: false,
  draftId: null as string | null,
  legacyDraftBlocked: false,
  draftConfirmHeld: false,
  activeConversationId: 'conversation-A',
  boundConversationId: 'conversation-A' as string | null,
};

describe('decideChatRoute', () => {
  it('原话在三种初始状态下都进入聊天', () => {
    expect(decideChatRoute({ ...idle, text: PHRASE }).kind).toBe('chat');
    expect(
      decideChatRoute({ ...idle, text: PHRASE, targetPlanId: 'old-plan' }).kind,
    ).toBe('chat');
    expect(
      decideChatRoute({ ...idle, text: PHRASE, draftId: 'old-draft' }).kind,
    ).toBe('chat');
  });

  it('普通提问、页面规划和资料建议都不重排', () => {
    expect(
      decideChatRoute({
        ...idle,
        text: '每天背单词有什么技巧',
        targetPlanId: 'old-plan',
      }).kind,
    ).toBe('chat');
    expect(
      decideChatRoute({
        ...idle,
        text: '栈和队列有什么区别',
        targetPlanId: 'old-plan',
        contextType: 'plan',
      }).kind,
    ).toBe('chat');
    expect(
      decideChatRoute({
        ...idle,
        text: '推荐数据结构教材',
        targetPlanId: 'old-plan',
      }).kind,
    ).toBe('chat');
  });

  it('明确修改当前计划仍重排', () => {
    expect(
      decideChatRoute({
        ...idle,
        text: '把当前计划每天改成30分钟',
        targetPlanId: 'old-plan',
      }).kind,
    ).toBe('regenerate');
  });

  it('开始日只接收日期回复，原话留在聊天', () => {
    expect(
      decideChatRoute({
        ...idle,
        text: PHRASE,
        targetPlanId: 'old-plan',
        awaitingStart: true,
      }).kind,
    ).toBe('chat');
    expect(
      decideChatRoute({
        ...idle,
        text: '今天',
        awaitingStart: true,
        startPlanId: 'plan-1',
      }).kind,
    ).toBe('start');
    expect(
      decideChatRoute({
        ...idle,
        text: '今天',
        awaitingStart: true,
      }).kind,
    ).toBe('chat');
  });

  it('换话题后的确定先重述草稿，不直接澄清落库', () => {
    const bypass = decideChatRoute({
      ...idle,
      text: PHRASE,
      draftId: 'old-draft',
    });
    expect(bypass.kind).toBe('chat');
    expect(bypass.holdDraft).toBe(true);
    expect(
      decideChatRoute({
        ...idle,
        text: '确定',
        draftId: 'old-draft',
        draftConfirmHeld: true,
      }).kind,
    ).toBe('restate-draft');
    expect(
      decideChatRoute({
        ...idle,
        text: '确定',
        draftId: 'old-draft',
        draftConfirmHeld: false,
      }).kind,
    ).toBe('clarify');
  });

  it('草稿补充只回答当前问题', () => {
    expect(
      decideChatRoute({
        ...idle,
        text: '零基础',
        draftId: 'old-draft',
        clarifyQuestion: '请补充你的当前基础',
      }).kind,
    ).toBe('clarify');
    expect(
      decideChatRoute({
        ...idle,
        text: '零基础',
        draftId: 'old-draft',
        clarifyQuestion: '请补充你的目标日期',
      }).kind,
    ).toBe('chat');
    expect(
      decideChatRoute({ ...idle, text: '零基础', draftId: 'old-draft' }).kind,
    ).toBe('chat');
  });

  it('无关短句、取消和明确调整不被草稿补充截走', () => {
    const asking = {
      ...idle,
      draftId: 'old-draft',
      clarifyQuestion: '请补充你的当前基础',
      targetPlanId: 'old-plan',
    };
    expect(decideChatRoute({ ...asking, text: '先看看' }).kind).toBe('chat');
    expect(decideChatRoute({ ...asking, text: '取消' }).kind).toBe('chat');
    expect(
      decideChatRoute({
        ...asking,
        text: '把当前计划每天改成30分钟',
        clarifyQuestion: '请补充你的完成标准',
      }).kind,
    ).toBe('regenerate');
  });

  it('新草稿存在时不再把日期交给旧计划的开始日', () => {
    expect(
      decideChatRoute({
        ...idle,
        text: '今天',
        awaitingStart: true,
        startPlanId: 'old-plan',
        draftId: 'new-draft',
        clarifyQuestion: '请补充你的当前基础',
      }).kind,
    ).toBe('chat');
  });

  it('另一会话不被这份草稿或开始日截走', () => {
    const other = { ...idle, activeConversationId: 'conversation-B' };
    expect(
      decideChatRoute({ ...other, text: PHRASE, draftId: 'old-draft' }).kind,
    ).toBe('chat');
    expect(
      decideChatRoute({ ...other, text: '今天', awaitingStart: true }).kind,
    ).toBe('chat');
    expect(
      decideChatRoute({ ...other, text: '确定', draftId: 'old-draft' }).kind,
    ).toBe('chat');
  });

  it('已关闭的旧草稿仍拒绝确认词', () => {
    expect(
      decideChatRoute({
        ...idle,
        text: '确定',
        legacyDraftBlocked: true,
        draftId: null,
      }).kind,
    ).toBe('legacy-blocked');
  });

  it('重述文案带上草稿和摘要，并说明这一次不写入', () => {
    const text = draftRestateText('old-draft', null, '先学线性表');
    expect(text).toContain('old-draft');
    expect(text).toContain('先学线性表');
    expect(text).toContain('不写入');
  });

  it('摘要只属于这份草稿', () => {
    expect(summaryForDraft('old-draft', 'old-draft', '先学线性表')).toBe('先学线性表');
    expect(summaryForDraft('old-draft', 'other-draft', '别的规划摘要')).toBeNull();
  });
});
