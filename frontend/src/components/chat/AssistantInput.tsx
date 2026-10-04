/**
 * 助手输入框 —— 悬浮窗和全屏聊天主界面**共用同一个组件**。
 *
 * 主人的要求是「语言发送聊天框保持和小聊天框一样」，所以这里不是"长得像"，
 * 而是字面意义上的同一个组件：星云光带、星芒图标、发送/停止按钮全部复用
 * `assistant-input-*` 那套 CSS，改一处两边一起变。
 */
import { Send, Sparkles, Square } from 'lucide-react';
import { isPauseRequest } from '@/lib/pauseRequest';

export interface AssistantInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  placeholder: string;
}

function AssistantInput({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  placeholder,
}: AssistantInputProps) {
  return (
    <div className="assistant-input-container">
      <div className="assistant-input-ring assistant-input-nebula" aria-hidden="true" />
      <div className="assistant-input-ring assistant-input-starfield" aria-hidden="true" />
      <div
        className="assistant-input-ring assistant-input-cosmic-ring"
        aria-hidden="true"
      />
      <div className="assistant-input-ring assistant-input-stardust" aria-hidden="true" />

      <div className="assistant-input-field">
        <Sparkles className="assistant-input-icon h-4 w-4" aria-hidden="true" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // isComposing：中文输入法选词时回车是「上屏」，不能当成发送
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={placeholder}
          className="assistant-input-el"
        />
        {streaming && !isPauseRequest(value) ? (
          <button
            type="button"
            aria-label="停止生成"
            onClick={onStop}
            className="assistant-input-btn assistant-input-btn-stop"
          >
            <Square className="h-4 w-4" fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="发送"
            onClick={onSend}
            disabled={!value.trim()}
            className="assistant-input-btn"
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default AssistantInput;
