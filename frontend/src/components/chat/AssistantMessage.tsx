import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Copy,
  MoreHorizontal,
  RefreshCw,
  Volume2,
} from 'lucide-react';
import { AssistantMarkdown, stripAssistantMarkup } from '@/lib/assistantMarkdown';
import { extractChatPractice } from '@/lib/chatPracticeExtract';
import { ApiError } from '@/lib/httpClient';
import { savePracticeFromChat } from '@/lib/practiceApi';
import { playAssistantSpeech, type SpeechPlayback } from '@/lib/assistantSpeech';
import { selectActiveMessages, useAssistantStore, type ChatMessage } from '@/store';

const REGENERATE_TIP = '点击将重新生成内容，此会话后的内容都将被覆盖，请谨慎操作';

/** ⋯ 菜单尺寸（w-44 + 7 项），用于把浮层夹回视口内。 */
const MENU_W = 176;
const MENU_EST_H = 268;

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

/**
 * 助手回复：悬停后在下方显示四个操作 —— 复制 / 朗读 / 重新生成 / ⋯。
 * 评价、分享、反馈、删除这些低频动作收进 ⋯ 菜单，避免一排八个图标糊在消息下面。
 */
function AssistantMessage({ message, bubbleClassName, onResend }: AssistantMessageProps) {
  const messages = useAssistantStore(selectActiveMessages);
  const removeMessage = useAssistantStore((s) => s.removeMessage);
  const [vote, setVote] = useState<'up' | 'down' | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const speechPlayback = useRef<SpeechPlayback | null>(null);
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
    setMoreOpen(false);
    setFeedbackOpen(false);
  };

  useEffect(
    () => () => {
      speechPlayback.current?.stop();
    },
    [],
  );

  // ⋯ 菜单改成点击开，就要有对应的关闭：点外面或按 Esc。
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (moreBtnRef.current?.contains(target)) return;
      closeMore();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // 拦在 document：同一次 Esc 不能再冒泡到 window 把整个聊天面板关掉。
      event.stopPropagation();
      closeMore();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  const regenerate = () => {
    const index = messages.findIndex((item) => item.id === message.id);
    for (let i = index - 1; i >= 0; i -= 1) {
      const previous = messages[i];
      if (previous?.role === 'user') {
        speechPlayback.current?.stop();
        onResend(previous.id, previous.content);
        return;
      }
    }
  };

  const speak = () => {
    setSpeechError(null);
    if (speechPlayback.current?.blocked) {
      setSpeaking(true);
      speechPlayback.current.retry();
      return;
    }
    if (speaking) {
      speechPlayback.current?.stop();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    speechPlayback.current = playAssistantSpeech(plainAssistant(message.content), {
      onEnd: () => setSpeaking(false),
      onError: (error) => { setSpeaking(false); setSpeechError(error.message); },
      onBlocked: () => { setSpeaking(false); setSpeechError('请再点一下朗读按钮播放'); },
    });
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
          <button type="button" aria-label="复制" title="复制" onClick={() => copyText(shown)} className={iconBtn}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={speaking ? '停止朗读' : '朗读'}
            title={speaking ? '停止朗读' : '朗读'}
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
          <button
            ref={moreBtnRef}
            type="button"
            aria-label="更多"
            title="更多"
            aria-expanded={moreOpen}
            onClick={() => {
              if (moreOpen) {
                closeMore();
                return;
              }
              const rect = moreBtnRef.current?.getBoundingClientRect();
              if (rect) {
                // 操作行现在只有四个图标，⋯ 离屏幕左边很近：菜单右对齐到按钮时
                // 会整块甩到视口外，这里把 x 夹回可视区；下方放不下就翻到上面。
                const x = Math.max(rect.right, MENU_W + 8);
                const below = rect.bottom + 4;
                const y =
                  below + MENU_EST_H > window.innerHeight - 8
                    ? Math.max(8, rect.top - MENU_EST_H - 4)
                    : below;
                setMenuPos({ x, y });
              }
              setMoreOpen(true);
            }}
            className={iconBtn}
          >
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      {speechError && <p role="status" className="mt-1 text-xs text-brandDark/60">{speechError}</p>}
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
                    aria-pressed={vote === 'up'}
                    className="block w-full px-3 py-2 text-left hover:bg-white/10"
                    onClick={() => {
                      setVote((current) => (current === 'up' ? null : 'up'));
                      closeMore();
                    }}
                  >
                    {vote === 'up' ? '已点赞' : '点赞'}
                  </button>
                  <button
                    type="button"
                    aria-pressed={vote === 'down'}
                    className="block w-full px-3 py-2 text-left hover:bg-white/10"
                    onClick={() => {
                      setVote((current) => (current === 'down' ? null : 'down'));
                      closeMore();
                    }}
                  >
                    {vote === 'down' ? '已点踩' : '点踩'}
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left hover:bg-white/10"
                    onClick={() => {
                      share();
                      closeMore();
                    }}
                  >
                    分享
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
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-red-300 hover:bg-white/10"
                    onClick={() => {
                      removeMessage(message.id);
                      closeMore();
                    }}
                  >
                    删除这条消息
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
