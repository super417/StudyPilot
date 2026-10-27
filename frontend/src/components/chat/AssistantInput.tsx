/**
 * 助手输入框 —— 悬浮窗和全屏聊天主界面**共用同一个组件**。
 *
 * 主人的要求是「语言发送聊天框保持和小聊天框一样」，所以这里不是"长得像"，
 * 而是字面意义上的同一个组件：星云光带、星芒图标、发送/停止按钮全部复用
 * `assistant-input-*` 那套 CSS，改一处两边一起变。
 *
 * 两种排版，材质完全相同（近黑绿底 #04150e、青绿旋转光带、星标、方块发送钮）：
 *   - `pill`    单行胶囊（悬浮小窗，52px）
 *   - `stacked` 两行（对话页）：上沿打字，下沿左边「星标 + 控件（模型 / 思考强度）」、
 *               右边发送钮 —— 就是 LobeHub 那个 composer 的控制行位置。
 */
import type { ReactNode } from 'react';
import { Send, Sparkles, Square } from 'lucide-react';
import { isPauseRequest } from '@/lib/pauseRequest';

export interface AssistantInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  placeholder: string;
  /** 排版变体，默认单行胶囊。 */
  variant?: 'pill' | 'stacked';
  /** `stacked` 时插在星标右侧、发送钮左侧的控件（对话页放「模型 · 思考强度」入口）。 */
  controls?: ReactNode;
}

function AssistantInput({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  placeholder,
  variant = 'pill',
  controls,
}: AssistantInputProps) {
  const stacked = variant === 'stacked';

  const sendButton =
    streaming && !isPauseRequest(value) ? (
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
    );

  const field = (
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
      className={`assistant-input-el ${stacked ? 'assistant-input-el--stacked' : ''}`}
    />
  );

  return (
    <div
      className={`assistant-input-container ${
        stacked ? 'assistant-input-container--stacked' : ''
      }`}
    >
      <div className="assistant-input-ring assistant-input-nebula" aria-hidden="true" />
      <div className="assistant-input-ring assistant-input-starfield" aria-hidden="true" />
      <div
        className="assistant-input-ring assistant-input-cosmic-ring"
        aria-hidden="true"
      />
      <div className="assistant-input-ring assistant-input-stardust" aria-hidden="true" />

      {stacked ? (
        <div className="assistant-input-field assistant-input-field--stacked">
          {field}
          <div className="assistant-input-controls">
            <Sparkles className="assistant-input-icon h-4 w-4" aria-hidden="true" />
            {/* 右下角：模型入口紧贴发送钮 —— 对齐参考图里那个 composer 的控制行 */}
            <div className="assistant-input-controls-right">
              {controls}
              {sendButton}
            </div>
          </div>
        </div>
      ) : (
        <div className="assistant-input-field">
          <Sparkles className="assistant-input-icon h-4 w-4" aria-hidden="true" />
          {field}
          {sendButton}
        </div>
      )}
    </div>
  );
}

export default AssistantInput;
