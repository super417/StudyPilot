/**
 * 右侧会话列表栏 —— 占屏幕右侧 1/3，纵向铺满。
 *
 * 每次聊天自成一条记录，这里负责新建 / 切换 / 删除。
 * 删除是**一步到位**：点垃圾桶就删，同时打后端 `DELETE /api/conversations/{id}`
 * （消息跟着级联清掉），列表里立刻不再显示这一条。删除中按钮转圈并锁住，
 * 避免手快连点；失败时在列表上方给一行红字，记录原样留着。
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, MessageSquarePlus, Trash2, X } from 'lucide-react';
import { ApiError } from '@/lib/httpClient';
import { useAssistantStore } from '@/store';

export interface SessionListProps {
  onClose: () => void;
}

function pad(v: number): string {
  return String(v).padStart(2, '0');
}

/** 今天给时刻，昨天给「昨天」，更早给月/日 —— 列表里一眼能分出新旧。 */
function formatTime(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function SessionList({ onClose }: SessionListProps) {
  const conversations = useAssistantStore((s) => s.conversations);
  const activeId = useAssistantStore((s) => s.activeId);
  const startConversation = useAssistantStore((s) => s.startConversation);
  const switchConversation = useAssistantStore((s) => s.switchConversation);
  const deleteConversation = useAssistantStore((s) => s.deleteConversation);

  /** 正在删除的会话 id —— 只用来锁按钮 + 转圈，不再做二次确认 */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    setError(null);
    try {
      // 前后端一起删：repository 走 DELETE 接口，成功后 store 才把它摘掉。
      // 后端失败会抛到这里，列表保持不变 —— 不会出现「界面没了但服务器还有」。
      await deleteConversation(id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '删除失败，请稍后重试');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <motion.aside
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-none fixed inset-y-0 right-0 z-20 w-full pt-20 pb-6 pl-3 pr-6 sm:w-1/3"
    >
      {/* 同 ChatPanel：顶部 padding 区让点击穿过，否则会盖住导航里的「聊天记录」按钮 */}
      <div className="liquid-glass pointer-events-auto flex h-full flex-col rounded-[28px]">
        <header className="flex items-center justify-between gap-2 px-5 pb-3 pt-5">
          <div>
            <h2 className="text-[15px] font-medium text-brandDark">聊天记录</h2>
            <p className="mt-0.5 text-[12px] text-brandDark/55">
              {conversations.length} 条会话 · 每条独立保存
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void startConversation()}
              aria-label="新建对话"
              title="新建对话"
              className="rounded-full p-1.5 text-brandDark/70 transition-colors hover:bg-white/70 hover:text-brandDark"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭聊天记录"
              title="关闭"
              className="rounded-full p-1.5 text-brandDark/70 transition-colors hover:bg-white/70 hover:text-brandDark"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {error ? (
            <p
              role="alert"
              className="mb-2 rounded-xl bg-red-500/10 px-3 py-2 text-[12px] leading-relaxed text-red-700"
            >
              {error}
            </p>
          ) : null}

          {conversations.length === 0 ? (
            <p className="px-2 pt-8 text-center text-[13px] leading-relaxed text-brandDark/50">
              还没有聊天记录
              <br />
              点左侧聊天窗顶部「新聊天」开始第一次对话
            </p>
          ) : (
            <ul className="space-y-1.5">
              {conversations.map((conversation) => {
                const isActive = conversation.id === activeId;
                const isDeleting = deletingId === conversation.id;
                return (
                  <li key={conversation.id}>
                    <div
                      className={`group flex items-center gap-2 rounded-2xl px-3 py-2.5 transition-colors ${
                        isActive ? 'bg-white/80' : 'hover:bg-white/55'
                      } ${isDeleting ? 'opacity-60' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => void switchConversation(conversation.id)}
                        disabled={isDeleting}
                        className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                      >
                        <span
                          className={`block truncate text-[13.5px] ${
                            isActive ? 'font-medium text-brandDark' : 'text-brandDark/80'
                          }`}
                        >
                          {conversation.title}
                        </span>
                        <span className="mt-0.5 block text-[11.5px] text-brandDark/45">
                          {formatTime(conversation.updatedAt)}
                          {conversation.contextType === 'plan' ? ' · 学习规划' : ''}
                          {conversation.contextType === 'mistake' ? ' · 错题' : ''}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleDelete(conversation.id)}
                        disabled={deletingId !== null}
                        aria-label="删除这条会话"
                        title="删除"
                        className="shrink-0 rounded-full p-1.5 text-brandDark/35 transition-colors hover:bg-white/80 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isDeleting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </motion.aside>
  );
}

export default SessionList;
