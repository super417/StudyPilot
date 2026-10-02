import ChatWindow from './ChatWindow';
import FloatingIcon from './FloatingIcon';

/**
 * AssistantWidget —— 全局 AI 助手悬浮窗（组合 FloatingIcon + ChatWindow）。
 *
 * 在 App 顶层挂载一次即可全局悬浮于所有页面之上（fixed 定位，z-index 高于内容）。
 * 图标常驻右下角，点击弹出聊天窗口；两者相互独立定位，互不遮挡布局。
 */
function AssistantWidget() {
  return (
    <>
      <ChatWindow />
      <FloatingIcon />
    </>
  );
}

export default AssistantWidget;
