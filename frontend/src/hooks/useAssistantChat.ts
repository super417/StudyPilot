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
import { streamPlanRegenerate } from '@/lib/plansApi';
import { streamAssistantChat } from '@/lib/assistantApi';
import { ApiError } from '@/lib/httpClient';

/** `acceptQueued` 为 false 时先别发（悬浮窗关着）。全屏面板挂载即接收。 */
export function useAssistantChat(acceptQueued = true) {
  const context = useAssistantStore((s) => s.context);
  const streaming = useAssistantStore((s) => s.streaming);
  const activeId = useAssistantStore((s) => s.activeId);
  const queuedPrompt = useAssistantStore((s) => s.queuedPrompt);
  const addMessage = useAssistantStore((s) => s.addMessage);
  const appendStreamChunk = useAssistantStore((s) => s.appendStreamChunk);
  const setStreaming = useAssistantStore((s) => s.setStreaming);
  const stopStreaming = useAssistantStore((s) => s.stopStreaming);

  const lastPlanId = usePlanSessionStore((s) => s.lastPlanId);
  const setLastPlanId = usePlanSessionStore((s) => s.setLastPlanId);
  const markSkipped = useDocumentsStore((s) => s.markSkipped);

  /** 用户主动按了停止，或流式被中断 —— 用于在列表底部提示"响应未完成" */
  const [interrupted, setInterrupted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

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
    abortRef.current?.abort();
    stopStreaming();
    setInterrupted(true);
  }, [stopStreaming]);

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || streaming) return;

      setInterrupted(false);
      addMessage({
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: text,
      });

      // 已有规划且用户在改规划：走 regenerate SSE
      if (lastPlanId && (context?.type === 'plan' || /规划|阶段|每天|复习计划/.test(text))) {
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
                onStatus: (s) => pushAssistant(s),
                onNotice: (d) => {
                  if (d.skippedDocs?.length) markSkipped(d.skippedDocs);
                  if (d.message) pushAssistant(`提示：${d.message}`);
                },
                onDone: (d) => {
                  setLastPlanId(d.planId);
                  summary = `规划已按你的说明更新（${d.phases} 个阶段）。可到 Roadmap 查看本周任务。`;
                },
                onError: (d) => pushAssistant(`调整失败（${d.code}）：${d.message}`),
              },
              ac.signal,
            );
            if (summary && !ac.signal.aborted) await typewrite(summary, ac.signal);
          } catch (err) {
            if (!ac.signal.aborted) {
              pushAssistant(
                err instanceof ApiError ? err.message : '规划调整失败，请稍后重试',
              );
            }
          } finally {
            stopStreaming();
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
              onStatus: (s) => pushAssistant(s),
              onToken: (delta) => {
                sawToken = true;
                appendStreamChunk(delta);
              },
              onError: (code, message) => {
                pushAssistant(
                  code === 'NO_API_KEY'
                    ? `请先在个人中心配置并验证 API（${message}）`
                    : `回答中断（${code}）：${message}`,
                );
              },
              onDone: () => {
                if (!sawToken) {
                  pushAssistant('未检索到足够可靠依据，请补充科目/题目或上传考研资料后再问。');
                }
              },
            },
            ac.signal,
          );
        } catch (err) {
          if (!ac.signal.aborted) {
            pushAssistant(err instanceof ApiError ? err.message : '助手请求失败，请稍后重试');
          } else if (sawToken) {
            pushAssistant('响应未完成（已停止），已保留上方内容。');
          }
        } finally {
          stopStreaming();
        }
      })();
    },
    [
      addMessage,
      appendStreamChunk,
      context,
      lastPlanId,
      markSkipped,
      pushAssistant,
      setLastPlanId,
      setStreaming,
      stopStreaming,
      streaming,
      typewrite,
    ],
  );

  useEffect(() => {
    if (!acceptQueued || !activeId || streaming || !queuedPrompt) return;
    const text = useAssistantStore.getState().queuedPrompt;
    if (!text) return;
    useAssistantStore.setState({ queuedPrompt: null });
    send(text);
  }, [acceptQueued, activeId, streaming, queuedPrompt, send]);

  return { send, stop, streaming, interrupted, abortRef };
}
