const MAINFRAME_HASH = '#/mainframe';
const WIDGET_EXPAND_QUERY = 'from=widget';

export function isMainframeRoute(hash = window.location.hash): boolean {
  return hash === MAINFRAME_HASH || hash.startsWith(`${MAINFRAME_HASH}?`);
}

/** 小窗右上角「展开」进来：hash 带 from=widget。品牌 / Tab 的普通入口没有这个标记。 */
export function isMainframeChatExpand(hash = window.location.hash): boolean {
  if (!isMainframeRoute(hash)) return false;
  const query = hash.slice(MAINFRAME_HASH.length);
  if (!query.startsWith('?')) return false;
  return new URLSearchParams(query.slice(1)).get('from') === 'widget';
}

/**
 * 普通入口：演示首屏（大图 + 药丸），不自动打开聊天面板。
 * 顺带清掉展开留下的 `?from=widget`，刷新或再点品牌不会沿用展开态。
 */
export function openMainframePage() {
  if (window.location.hash !== MAINFRAME_HASH) {
    window.location.hash = MAINFRAME_HASH;
  }
}

/** 从小窗展开：同一条演示页，但带入口标记，页面据此直接打开当前会话的聊天面板。 */
export function openMainframeFromWidget() {
  const next = `${MAINFRAME_HASH}?${WIDGET_EXPAND_QUERY}`;
  if (window.location.hash !== next) {
    window.location.hash = next;
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
