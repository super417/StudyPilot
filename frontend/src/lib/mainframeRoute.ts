const MAINFRAME_HASH = '#/mainframe';

export function isMainframeRoute(hash = window.location.hash): boolean {
  return hash === MAINFRAME_HASH || hash.startsWith(`${MAINFRAME_HASH}?`);
}

/**
 * 进入演示首屏。
 *
 * 不带任何参数：**任何方式进来都先显示首屏**（大图 + 药丸按钮），
 * 点「和助手聊两句 / 说出你的学习目标」才弹聊天面板。
 * 从悬浮窗「展开全屏」进来时也走同一条路径 —— 不再自动展开聊天框，
 * 否则主人看到的第一个画面就是一块玻璃面板盖住人脸。
 *
 * 顺带把历史链接里残留的 `?chat=1` 抹掉：`isMainframeRoute` 仍然认它，
 * 但留着只会让刷新后的地址栏一直挂着个没用的参数。
 */
export function openMainframePage() {
  if (window.location.hash !== MAINFRAME_HASH) {
    window.location.hash = MAINFRAME_HASH;
  }
}

export function closeMainframePage() {
  if (!isMainframeRoute()) return;
  window.history.pushState(
    '',
    document.title,
    `${window.location.pathname}${window.location.search}`,
  );
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
