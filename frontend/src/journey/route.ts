const JOURNEY_HASH = '#/journey';

export function isJourneyRoute(hash = window.location.hash): boolean {
  return hash === JOURNEY_HASH || hash.startsWith(`${JOURNEY_HASH}?`);
}

/** 显式演示入口。不会在接口失败时自动冒充真数据。 */
export function isJourneyDemo(hash = window.location.hash): boolean {
  if (!isJourneyRoute(hash)) return false;
  const query = hash.slice(JOURNEY_HASH.length);
  if (!query.startsWith('?')) return false;
  return new URLSearchParams(query.slice(1)).get('demo') === '1';
}

export function openJourneyPage() {
  if (!isJourneyRoute()) window.location.hash = JOURNEY_HASH;
}

export function closeJourneyPage() {
  if (!isJourneyRoute()) return;
  window.history.pushState(
    '',
    document.title,
    `${window.location.pathname}${window.location.search}`,
  );
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
