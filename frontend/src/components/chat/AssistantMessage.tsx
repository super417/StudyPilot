import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Copy,
  MoreHorizontal,
  RefreshCw,
  Share2,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Volume2,
} from 'lucide-react';
import { AssistantMarkdown, stripAssistantMarkup } from '@/lib/assistantMarkdown';
import { extractChatPractice } from '@/lib/chatPracticeExtract';
import { ApiError } from '@/lib/httpClient';
import { savePracticeFromChat } from '@/lib/practiceApi';
import { selectActiveMessages, useAssistantStore, type ChatMessage } from '@/store';

const REGENERATE_TIP = '点击将重新生成内容，此会话后的内容都将被覆盖，请谨慎操作';

export interface AssistantMessageProps {
  message: ChatMessage;
  bubbleClassName: string;
  onResend: (messageId: string, content: string) => void;
}

function copyText(text: string) {
  void navigator.clipboard.writeText(text).catch(() => undefined);
}

function plainAssistant(text: string): string {
  return stripAssistantMarkup(text);
}

/** 助手回复：悬停后在下方显示删除、复制、评价、朗读、重生成、分享和更多。 */
function AssistantMessage({ message, bubbleClassName, onResend }: AssistantMessageProps) {
  const messages = useAssistantStore(selectActiveMessages);
  const removeMessage = useAssistantStore((s) => s.removeMessage);
  const [vote, setVote] = useState<'up' | 'down' | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [openCitation, setOpenCitation] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [savePhase, setSavePhase] = useState<'idle' | 'confirm' | 'saving' | 'done'>('idle');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  // 启发式：同时含「题」「答案」且能切出段落才显示；可能误判，宁可少显示。
  const practiceParts = useMemo(
    () => (message.streaming ? null : extractChatPractice(message.content)),
    [message.content, message.streaming],
  );

  // 同一份资料（按 docId）只保留一条，避免多 chunk 重复列出文件名
  const uniqueCitations = useMemo(() => {
    const list = message.citations ?? [];
    const seen = new Set<string>();
    const out: NonNullable<ChatMessage['citations']> = [];
    for (const item of list) {
      const key = item.docId || item.filename;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }, [message.citations]);

  const closeMore = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setMoreOpen(false);
    setFeedbackOpen(false);
  };

  const scheduleCloseMore = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(closeMore, 150);
  };

  const cancelCloseMore = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
      window.speechSynthesis?.cancel();
    },
    [],
  );

  const regenerate = () => {
    const index = messages.findIndex((item) => item.id === message.id);
    for (let i = index - 1; i >= 0; i -= 1) {
      const previous = messages[i];
      if (previous?.role === 'user') {
        window.speechSynthesis?.cancel();
        onResend(previous.id, previous.content);
        return;
      }
    }
  };

  const speak = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(plainAssistant(message.content));
    utterance.lang = 'zh-CN';
    utterance.onend = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(utterance);
  };

  const share = () => {
    const text = plainAssistant(message.content);
    if (!navigator.share) {
      copyText(text);
      return;
    }
    void navigator.share({ title: 'StudyPilot', text }).catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      copyText(text);
    });
  };

  const submitFeedback = () => {
    const text = feedback.trim();
    if (!text) return;
    localStorage.setItem(`studypilot-msg-feedback:${message.id}`, text);
    setFeedbackSent(true);
  };

  const confirmSavePractice = async () => {
    if (!practiceParts || savePhase === 'saving' || savePhase === 'done') return;
    setSavePhase('saving');
    setSaveMsg(null);
    try {
      await savePracticeFromChat({
        question: practiceParts.question,
        answer: practiceParts.answer,
        explanation: '',
        subject: '',
        sourceRefs: null,
      });
      setSavePhase('done');
      setSaveMsg('已存入今日练习，去习题本作答');
    } catch (err) {
      setSavePhase('confirm');
      setSaveMsg(err instanceof ApiError ? err.message : '存入失败，请稍后重试');
    }
  };

  const iconBtn =
    'rounded-full p-1 text-brandDark/55 hover:bg-white/80 hover:text-brandDark';
  const shown = plainAssistant(message.content);

  return (
    <div className="group flex min-w-0 max-w-[85%] flex-col items-start">
      <div className={`${bubbleClassName} max-w-full overflow-hidden break-words [overflow-wrap:anywhere]`}>
        <AssistantMarkdown text={message.content} />
        {message.streaming ? <span className="ml-0.5 animate-pulse">▋</span> : null}
        {uniqueCitations.length ? (
          <div className="mt-3 border-t border-brandDark/10 pt-2">
            <p className="mb-1 text-[11px] font-medium text-brandDark/50">资料来源</p>
            <ul className="space-y-1">
              {uniqueCitations.map((item, index) => (
                <li key={item.docId || item.filename} className="text-xs text-brandDark/80">
                  <button
                    type="button"
                    className="font-medium underline-offset-2 hover:underline"
                    onClick={() => setOpenCitation((current) => (current === index ? null : index))}
                  >
                    {item.filename}
                  </button>
                  {openCitation === index ? (
                    <p className="mt-1 whitespace-pre-wrap text-brandDark/70">{item.snippet}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {practiceParts ? (
          <div className="mt-3 border-t border-brandDark/10 pt-2 text-xs">
            {savePhase === 'done' ? (
              <button
                type="button"
                disabled
                className="rounded-lg bg-brandDark/5 px-3 py-1.5 text-xs font-medium text-brandDark/50"
              >
                已存入 ✓
              </button>
            ) : savePhase === 'confirm' || savePhase === 'saving' ? (
              <div className="space-y-2">
                <p className="leading-relaxed text-brandDark/70">
                  存入后请在习题本作答，答对计入完成，答错自动进入错题本。
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={savePhase === 'saving'}
                    onClick={() => void confirmSavePractice()}
                    className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {savePhase === 'saving' ? '存入中…' : '确认存入'}
                  </button>
                  <button
                    type="button"
                    disabled={savePhase === 'saving'}
                    onClick={() => {
                      setSavePhase('idle');
                      setSaveMsg(null);
                    }}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-brandDark/60 hover:bg-brandDark/5 disabled:opacity-50"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSavePhase('confirm');
                  setSaveMsg(null);
                }}
                className="rounded-lg bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/15"
              >
                存入今日练习
              </button>
            )}
            {saveMsg ? (
              <p className="mt-1.5 text-brandDark/60" role="status">
                {saveMsg}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {message.streaming ? null : (
        <div className="mt-1 flex items-center gap-0.5 px-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            aria-label="删除"
            title="删除"
            onMouseEnter={closeMore}
            onClick={() => removeMessage(message.id)}
            className={`${iconBtn} hover:text-dangerText`}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button type="button" aria-label="复制" title="复制" onMouseEnter={closeMore} onClick={() => copyText(shown)} className={iconBtn}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="点赞"
            title="点赞"
            aria-pressed={vote === 'up'}
            onMouseEnter={closeMore}
            onClick={() => setVote((current) => (current === 'up' ? null : 'up'))}
            className={`${iconBtn} ${vote === 'up' ? 'text-brand' : ''}`}
          >
            <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="点踩"
            title="点踩"
            aria-pressed={vote === 'down'}
            onMouseEnter={closeMore}
            onClick={() => setVote((current) => (current === 'down' ? null : 'down'))}
            className={`${iconBtn} ${vote === 'down' ? 'text-dangerText' : ''}`}
          >
            <ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={speaking ? '停止朗读' : '朗读'}
            title={speaking ? '停止朗读' : '朗读'}
            onMouseEnter={closeMore}
            onClick={speak}
            className={`${iconBtn} ${speaking ? 'text-brand' : ''}`}
          >
            <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="重新生成"
            onMouseEnter={(event) => {
              closeMore();
              const rect = event.currentTarget.getBoundingClientRect();
              setTip({ x: rect.left + rect.width / 2, y: rect.bottom + 8 });
            }}
            onMouseLeave={() => setTip(null)}
            onClick={regenerate}
            className={iconBtn}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button type="button" aria-label="分享" title="分享" onMouseEnter={closeMore} onClick={share} className={iconBtn}>
            <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            ref={moreBtnRef}
            type="button"
            aria-label="更多"
            title="更多"
            aria-expanded={moreOpen}
            onMouseEnter={() => {
              cancelCloseMore();
              setTip(null);
              const rect = moreBtnRef.current?.getBoundingClientRect();
              if (rect) setMenuPos({ x: rect.right, y: rect.bottom + 4 });
              setMoreOpen(true);
            }}
            onMouseLeave={scheduleCloseMore}
            onClick={() => closeMore()}
            className={iconBtn}
          >
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      {tip
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[10000] w-56 -translate-x-1/2 rounded-lg bg-neutral-900 px-3 py-2 text-left text-xs leading-relaxed text-white shadow-lg"
              style={{ left: tip.x, top: tip.y }}
            >
              {REGENERATE_TIP}
            </div>,
            document.body,
          )
        : null}
      {moreOpen && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              onMouseEnter={cancelCloseMore}
              onMouseLeave={scheduleCloseMore}
              className="fixed z-[10000] w-44 rounded-xl bg-neutral-900 py-1 text-sm text-white shadow-lg"
              style={{ left: menuPos.x, top: menuPos.y, transform: 'translateX(-100%)' }}
            >
              {feedbackOpen ? (
                <form
                  className="space-y-2 px-3 py-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitFeedback();
                    closeMore();
                  }}
                >
                  {feedbackSent ? (
                    <p className="text-xs text-white/80">已提交</p>
                  ) : (
                    <>
                      <textarea
                        value={feedback}
                        autoFocus
                        rows={3}
                        placeholder="说说这条回复的问题"
                        onChange={(event) => setFeedback(event.target.value)}
                        className="w-full resize-none rounded-md bg-white/10 px-2 py-1 text-xs outline-none"
                      />
                      <button type="submit" className="text-xs text-white/90 hover:text-white">
                        提交
                      </button>
                    </>
                  )}
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left hover:bg-white/10"
                    onClick={() => {
                      copyText(shown);
                      closeMore();
                    }}
                  >
                    复制消息
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left hover:bg-white/10"
                    onClick={() => setFeedbackOpen(true)}
                  >
                    提交反馈
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left hover:bg-white/10"
                    onClick={() => {
                      copyText(message.id);
                      closeMore();
                    }}
                  >
                    复制request ID
                  </button>
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export default AssistantMessage;
