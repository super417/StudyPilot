/**
 * 助手「发一条消息」的完整逻辑 —— 悬浮窗和全屏聊天面板共用。
 *
 * 抽出来的原因：两处 UI 除了外壳长得不同，发送链路必须一模一样（规划改写走
 * regenerate SSE、普通提问走 chat SSE、错误文案一致）。复制两份迟早会漂移，
 * 而"同一个助手在两个入口给出不同行为"是最难查的那类 bug。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAssistantStore } from '@/store';
import { usePlanSessionStore } from '@/store/planSessionStore';
import { useDocumentsStore } from '@/store/documentsStore';
import { planStartQuestion, setPlanStart, streamPlanClarify, streamPlanRegenerate } from '@/lib/plansApi';
import { streamAssistantChat } from '@/lib/assistantApi';
import { isPauseRequest } from '@/lib/pauseRequest';
import { isPlanEditIntent, isResourceRequest } from '@/lib/resourceRequest';
import { ApiError } from '@/lib/httpClient';
import { useAuthStore } from '@/store/authStore';

function replyError(err: unknown, fallback: string, pushAssistant: (text: string) => void) {
  if (err instanceof ApiError && (err.status === 401 || err.code === 'UNAUTHENTICATED')) {
    useAuthStore.setState({
      status: 'unauthenticated',
      userId: null,
      dataLoad: null,
      error: null,
    });
    return;
  }
  pushAssistant(err instanceof ApiError ? err.message : fallback);
}
export function useAssistantChat(acceptQueued = true) {
  const context = useAssistantStore((s) => s.context);
  const streaming = useAssistantStore((s) => s.streaming);
  const activeId = useAssistantStore((s) => s.activeId);
  const queuedPrompt = useAssistantStore((s) => s.queuedPrompt);
  const addMessage = useAssistantStore((s) => s.addMessage);
  const appendStreamChunk = useAssistantStore((s) => s.appendStreamChunk);
  const attachCitations = useAssistantStore((s) => s.attachCitations);
  const setStreaming = useAssistantStore((s) => s.setStreaming);
  const stopStreaming = useAssistantStore((s) => s.stopStreaming);

  const lastPlanId = usePlanSessionStore((s) => s.lastPlanId);
  const setLastPlanId = usePlanSessionStore((s) => s.setLastPlanId);
  const setClarify = usePlanSessionStore((s) => s.setClarify);
  const setPreview = usePlanSessionStore((s) => s.setPreview);
  const clearClarify = usePlanSessionStore((s) => s.clearClarify);
  const markSkipped = useDocumentsStore((s) => s.markSkipped);

  /** 用户主动按了停止，或流式被中断 —— 用于在列表底部提示"响应未完成" */
  const [interrupted, setInterrupted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const abortReasonRef = useRef<'stop' | 'pause' | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const pushAssistant = useCallback(
    (content: string) => {
      addMessage({
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        content,
      });
    },
    [addMessage],
  );

  /** 本地逐字播放（用于 regenerate 返回的总结句，那条没有 token 流） */
  const typewrite = useCallback(
    async (text: string, signal: AbortSignal) => {
      setStreaming(true);
      for (const ch of text) {
        if (signal.aborted) break;
        appendStreamChunk(ch);
        await new Promise((r) => setTimeout(r, 12));
      }
      stopStreaming();
    },
    [appendStreamChunk, setStreaming, stopStreaming],
  );

  const stop = useCallback(() => {
    abortReasonRef.current = 'stop';
    abortRef.current?.abort();
    stopStreaming();
    setInterrupted(true);
  }, [stopStreaming]);

  const pause = useCallback(() => {
    abortReasonRef.current = 'pause';
    abortRef.current?.abort();
    stopStreaming();
    setInterrupted(false);
    pushAssistant('已暂停');
  }, [pushAssistant, stopStreaming]);

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      if (isPauseRequest(text)) {
        addMessage({
          id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'user',
          content: text,
        });
        pause();
        return;
      }
      if (useAssistantStore.getState().streaming) return;

      abortReasonRef.current = null;
      setInterrupted(false);
      addMessage({
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: text,
      });

      if (usePlanSessionStore.getState().awaitingStart) {
        const ac = new AbortController();
        abortRef.current = ac;
        setStreaming(true);
        void (async () => {
          try {
            const saved = await setPlanStart(text);
            if (ac.signal.aborted) return;
            usePlanSessionStore.setState({ awaitingStart: false });
            pushAssistant(`好，整个规划从 ${saved.startDate} 开始。路线图已按这个日期重排。`);
          } catch (err) {
            if (ac.signal.aborted) return;
            replyError(err, '开始日没记上，请再说一次今天、明天或具体日期。', pushAssistant);
          } finally {
            if (abortRef.current === ac) stopStreaming();
          }
        })();
        return;
      }

      const draftId = usePlanSessionStore.getState().draftId;
      if (draftId) {
        const ac = new AbortController();
        abortRef.current = ac;
        setStreaming(true);
        void (async () => {
          try {
            await streamPlanClarify(
              draftId,
              { message: text },
              {
                onClarify: (data) => {
                  if (ac.signal.aborted) return;
                  setClarify(data.draftId, data.question);
                  pushAssistant(data.question);
                },
                onPreview: (data) => {
                  if (ac.signal.aborted) return;
                  setPreview(data.draftId);
                  pushAssistant(data.summary);
                },
                onDone: (data) => {
                  if (ac.signal.aborted) return;
                  clearClarify();
                  setLastPlanId(data.planId);
                  usePlanSessionStore.getState().askForStart();
                  pushAssistant(`已写入规划，共 ${data.phases} 个阶段。\n${planStartQuestion()}`);
                },
                onError: (data) => {
                  if (ac.signal.aborted) return;
                  pushAssistant(`规划失败（${data.code}）：${data.message}`);
                },
              },
              ac.signal,
            );
          } catch (err) {
            if (abortRef.current !== ac || abortReasonRef.current === 'pause') return;
            if (!ac.signal.aborted) {
              replyError(err, '规划请求失败，请稍后重试', pushAssistant);
            }
          } finally {
            if (abortRef.current === ac) stopStreaming();
          }
        })();
        return;
      }

      // 已有规划且用户在改规划、或在要具体学习资源：走 regenerate SSE
      if (
        lastPlanId &&
        (context?.type === 'plan' ||
          isPlanEditIntent(text) ||
          isResourceRequest(text))
      ) {
        const ac = new AbortController();
        abortRef.current = ac;
        setStreaming(true);
        void (async () => {
          let summary: string | null = null;
          try {
            await streamPlanRegenerate(
              lastPlanId,
              { message: text },
              {
                onStatus: (s) => {
                  if (ac.signal.aborted || abortReasonRef.current === 'pause') return;
                  pushAssistant(s);
                },
                onNotice: (d) => {
                  if (ac.signal.aborted || abortReasonRef.current === 'pause') return;
                  if (d.skippedDocs?.length) markSkipped(d.skippedDocs);
                  if (d.message) pushAssistant(`提示：${d.message}`);
                },
                onDone: (d) => {
                  if (ac.signal.aborted || abortReasonRef.current === 'pause') return;
                  setLastPlanId(d.planId);
                  usePlanSessionStore.getState().askForStart();
                  summary = `规划已按你的说明更新（${d.phases} 个阶段）。\n${planStartQuestion()}`;
                },
                onError: (d) => {
                  if (ac.signal.aborted || abortReasonRef.current === 'pause') return;
                  pushAssistant(`调整失败（${d.code}）：${d.message}`);
                },
              },
              ac.signal,
            );
            if (summary && !ac.signal.aborted) await typewrite(summary, ac.signal);
          } catch (err) {
            if (abortRef.current !== ac) return;
            if (!ac.signal.aborted) {
              pushAssistant(
                err instanceof ApiError ? err.message : '规划调整失败，请稍后重试',
              );
            }
          } finally {
            if (abortRef.current === ac) stopStreaming();
          }
        })();
        return;
      }

      // 默认：真实 /api/assistant/chat SSE（含领域拦截 / RAG 上下文）
      const ac = new AbortController();
      abortRef.current = ac;
      setStreaming(true);
      void (async () => {
        let sawToken = false;
        try {
          await streamAssistantChat(
            text,
            context
              ? {
                  type: context.type,
                  mistakeId: context.type === 'mistake' ? context.refId : undefined,
                  refId: context.refId,
                  hint: context.hint,
                }
              : { type: 'free' },
            {
              onStatus: (s) => {
                if (ac.signal.aborted || abortReasonRef.current === 'pause') return;
                pushAssistant(s);
              },
              onToken: (delta) => {
                if (ac.signal.aborted || abortReasonRef.current === 'pause') return;
                sawToken = true;
                appendStreamChunk(delta);
              },
              onError: (code, message) => {
                if (ac.signal.aborted || abortReasonRef.current === 'pause') return;
                pushAssistant(
                  code === 'NO_API_KEY'
                    ? `请先在个人中心配置并验证 API（${message}）`
                    : `回答中断（${code}）：${message}`,
                );
              },
              onDone: (data) => {
                if (ac.signal.aborted || abortReasonRef.current === 'pause') return;
                if (!sawToken) {
                  pushAssistant('这次没有生成内容，换个问法或补充科目/资料后再问一次。');
                  return;
                }
                if (data.citations?.length) attachCitations(data.citations);
              },
            },
            ac.signal,
          );
        } catch (err) {
          if (abortRef.current !== ac || abortReasonRef.current === 'pause') return;
          if (!ac.signal.aborted) {
            replyError(err, '助手请求失败，请稍后重试', pushAssistant);
          } else if (sawToken) {
            pushAssistant('响应未完成（已停止），已保留上方内容。');
          }
        } finally {
          if (abortRef.current === ac) stopStreaming();
        }
      })();
    },
    [
      addMessage,
      appendStreamChunk,
      attachCitations,
      context,
      lastPlanId,
      clearClarify,
      markSkipped,
      pushAssistant,
      setClarify,
      setPreview,
      setLastPlanId,
      setStreaming,
      stopStreaming,
      pause,
      typewrite,
    ],
  );

  /** 改一条已发出的消息：丢掉它和后面的回复，再按新内容走原来的发送。 */
  const resend = useCallback(
    (messageId: string, raw: string) => {
      const text = raw.trim();
      if (!text) return;
      abortRef.current?.abort();
      stopStreaming();
      setInterrupted(false);
      useAssistantStore.getState().truncateFrom(messageId);
      send(text);
    },
    [send, stopStreaming],
  );

  useEffect(() => {
    if (!acceptQueued || !activeId || streaming || !queuedPrompt) return;
    const text = useAssistantStore.getState().queuedPrompt;
    if (!text) return;
    useAssistantStore.setState({ queuedPrompt: null });
    send(text);
  }, [acceptQueued, activeId, streaming, queuedPrompt, send]);

  return { send, resend, stop, pause, streaming, interrupted, abortRef };
}
