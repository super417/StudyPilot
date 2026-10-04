import { useRef, useState } from 'react';
import { Copy, Pencil, Undo2 } from 'lucide-react';
import { useAssistantStore, type ChatMessage } from '@/store';

/** 10月2日 13:34 */
export function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hours}:${minutes}`;
}

export interface UserMessageProps {
  message: ChatMessage;
  bubbleClassName: string;
  /** 改完后按新内容重发，并让助手重新回复 */
  onResend: (messageId: string, content: string) => void;
}

/** 自己发出的消息：悬停显示时间、修改、撤回、复制。 */
function UserMessage({ message, bubbleClassName, onResend }: UserMessageProps) {
  const removeMessage = useAssistantStore((s) => s.removeMessage);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const committedRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  const fit = (el: HTMLTextAreaElement, size: { width: number; height: number }) => {
    el.style.width = `${size.width}px`;
    el.style.height = `${size.height}px`;
    el.style.height = `${Math.max(size.height, el.scrollHeight)}px`;
  };

  const save = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const cleaned = draft.trim();
    if (!cleaned || cleaned === message.content) {
      setDraft(message.content);
      setEditing(false);
      return;
    }
    onResend(message.id, cleaned);
    setEditing(false);
  };

  return (
    <div className="group flex min-w-0 max-w-[85%] flex-col items-end">
      <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] text-brandDark/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {message.createdAt ? <span>{formatMessageTime(message.createdAt)}</span> : null}
        <button
          type="button"
          aria-label="修改"
          title="修改"
          onClick={() => {
            committedRef.current = false;
            const node = bubbleRef.current;
            setBox(
              node ? { width: node.offsetWidth, height: node.offsetHeight } : null,
            );
            setDraft(message.content);
            setEditing(true);
          }}
          className="rounded-full p-0.5 hover:text-brandDark"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="撤回"
          title="撤回"
          onClick={() => removeMessage(message.id)}
          className="rounded-full p-0.5 hover:text-brandDark"
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="复制"
          title="复制"
          onClick={() => {
            void navigator.clipboard.writeText(message.content).catch(() => undefined);
          }}
          className="rounded-full p-0.5 hover:text-brandDark"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {editing ? (
        <textarea
          value={draft}
          autoFocus
          ref={(el) => {
            if (el && box) fit(el, box);
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            if (box) fit(event.target, box);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setDraft(message.content);
              setEditing(false);
            } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              save();
            }
          }}
          onBlur={save}
          className={`${bubbleClassName} box-border max-w-full resize-none overflow-hidden break-words outline-none [overflow-wrap:anywhere]`}
        />
      ) : (
        <div ref={bubbleRef} className={`${bubbleClassName} max-w-full break-words [overflow-wrap:anywhere]`}>
          {message.content}
        </div>
      )}
    </div>
  );
}

export default UserMessage;
