/** Concrete-page guard for saved legacy URLs; does not attest page content. */
export function isConcreteResourceUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const path = decodeURIComponent(url.pathname);
    if (/(^|\/)\.{1,2}(\/|$)/.test(path) || path.includes('\\')) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (host === 'bilibili.com' || host.endsWith('.bilibili.com')) {
      return /^\/video\/(?:BV[0-9A-Za-z]+|av[0-9]+)\/?$/.test(path);
    }
    return /^\/(?:video|course|courses|training|courseHome|learn|lecture|lesson)\/[^/]+(?:\/[^/]+)*\/?$/.test(path);
  } catch {
    return false;
  }
}
