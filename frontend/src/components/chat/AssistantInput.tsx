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
 *
 * 附件：`stacked` 的 `+` 打开两层菜单（Attachments → Upload File），选中的文件
 * 直接进**资料库**（POST /api/documents），上传完在输入条上方留一枚胶囊。
 * 之所以不塞进消息文本，是因为助手回答时会对「当前用户全部文档」做 RAG，
 * 进了库就自然能引用到，不需要在对话里再贴一遍文件名。
 */
import type { ReactNode } from 'react';
import {
  ChevronRight,
  FileUp,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isPauseRequest } from '@/lib/pauseRequest';
import {
  ACCEPT_ATTR,
  MAX_UPLOAD_BYTES,
  fileTypeFromName,
  uploadDocumentWithProgress,
} from '@/lib/documentsApi';

export interface AssistantInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  placeholder: string;
  /** 排版变体，默认单行胶囊。 */
  variant?: 'pill' | 'stacked';
  /** `stacked` 时紧跟星标的快捷动作（对话页放「开始今天」），对应参考图左下那个入口。 */
  leading?: ReactNode;
  /** `stacked` 时插在发送钮左侧的控件（对话页放「模型 · 思考强度」入口）。 */
  controls?: ReactNode;
}

/** 一枚正在上传 / 已完成的附件。上传成功即进了资料库，不随消息走。 */
interface AttachmentChip {
  key: string;
  name: string;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

function AssistantInput({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  placeholder,
  variant = 'pill',
  leading,
  controls,
}: AssistantInputProps) {
  const stacked = variant === 'stacked';
  const [attachOpen, setAttachOpen] = useState(false);
  /** 二级菜单：Attachments ▸ Upload File。 */
  const [attachSubOpen, setAttachSubOpen] = useState(false);
  const [chips, setChips] = useState<AttachmentChip[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 点空白处 / 按 Esc 收起附件菜单：菜单浮在输入框上方，不收起会一直挡着最后一条消息。
  useEffect(() => {
    if (!attachOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setAttachOpen(false);
        setAttachSubOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAttachOpen(false);
        setAttachSubOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [attachOpen]);

  const patchChip = (key: string, next: Partial<AttachmentChip>) =>
    setChips((prev) =>
      prev.map((chip) => (chip.key === key ? { ...chip, ...next } : chip)),
    );

  /** 选中文件后立刻上传；扩展名 / 体积在发请求前就拦掉，别等后端报 415。 */
  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    for (const file of Array.from(fileList)) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setChips((prev) => [...prev, { key, name: file.name, progress: 0, status: 'uploading' }]);

      if (!fileTypeFromName(file.name)) {
        patchChip(key, { status: 'error', error: '仅支持 PDF / DOCX / TXT / MD' });
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        patchChip(key, { status: 'error', error: '超过 20MB 上限' });
        continue;
      }

      void uploadDocumentWithProgress(file, (ratio) => patchChip(key, { progress: ratio }))
        .then(() => patchChip(key, { status: 'done', progress: 1 }))
        .catch((error: unknown) =>
          patchChip(key, {
            status: 'error',
            error: error instanceof Error ? error.message : '上传失败',
          }),
        );
    }
  };

  const openFilePicker = () => {
    setAttachOpen(false);
    setAttachSubOpen(false);
    fileRef.current?.click();
  };

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
    <div ref={rootRef} className="assistant-input-shell">
      {chips.length > 0 ? (
        <div className="assistant-input-uploads">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className={`assistant-input-upload-chip${
                chip.status === 'error' ? ' is-error' : ''
              }`}
            >
              <FileUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="assistant-input-upload-name" title={chip.name}>
                {chip.name}
              </span>
              <span className="assistant-input-upload-meta">
                {chip.status === 'uploading'
                  ? `${Math.round(chip.progress * 100)}%`
                  : chip.status === 'done'
                    ? '已入库'
                    : chip.error}
              </span>
              <button
                type="button"
                aria-label={`移除 ${chip.name}`}
                title="从输入框移除（资料库中保留）"
                onClick={() =>
                  setChips((prev) => prev.filter((item) => item.key !== chip.key))
                }
                className="assistant-input-upload-x"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

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
              <button
                type="button"
                aria-label="添加附件"
                aria-expanded={attachOpen}
                onClick={() => {
                  setAttachOpen((v) => !v);
                  setAttachSubOpen(false);
                }}
                className="assistant-input-attach-btn"
              >
                <Plus className="h-4 w-4" />
              </button>
              <Sparkles className="assistant-input-icon h-4 w-4" aria-hidden="true" />
              {leading}
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

      {attachOpen && stacked ? (
        <div className="assistant-input-attach-popover">
          {/*
            两级菜单：一级 Attachments，悬停或点击展开二级 Upload File。
            二级浮层是 group 的 DOM 子节点，鼠标移进去不会触发一级的 mouseleave。
          */}
          <div
            className="assistant-input-attach-group"
            onMouseEnter={() => setAttachSubOpen(true)}
            onMouseLeave={() => setAttachSubOpen(false)}
          >
            <button
              type="button"
              className="assistant-input-attach-row"
              aria-expanded={attachSubOpen}
              // 点击只「展开」不「切换」：悬停已经把二级打开了，再点一下不该把它关掉。
              // 键盘用户 Tab 到这一行也要能把二级召唤出来。
              onClick={() => setAttachSubOpen(true)}
              onFocus={() => setAttachSubOpen(true)}
            >
              <Paperclip className="h-4 w-4" />
              <span>Attachments</span>
              <ChevronRight className="h-3 w-3" />
            </button>
            {attachSubOpen ? (
              <div className="assistant-input-attach-submenu">
                <button
                  type="button"
                  className="assistant-input-attach-row"
                  onClick={openFilePicker}
                >
                  <FileUp className="h-4 w-4" />
                  <span>Upload File</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        className="hidden"
        onChange={(event) => {
          handleFiles(event.target.files);
          // 同一个文件连选两次也要触发 change
          event.target.value = '';
        }}
      />
    </div>
  );
}

export default AssistantInput;
